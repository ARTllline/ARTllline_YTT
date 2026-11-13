param([ValidateSet('backup', 'restore')][string]$Action)
$ErrorActionPreference = 'Stop'
$project = 'B:\DnD\YTT'
Set-Location -LiteralPath $project
$work = Join-Path $project 'artifacts\content-07b'
$backup = Join-Path $work 'backup'
$runtime = Join-Path $work 'runtime'
$mysqlBin = 'C:\OSPanel\modules\database\MySQL-8.0-Win10\bin'
foreach ($folder in @($backup, $runtime)) {
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    $taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $folder /inheritance:r /grant:r "*${taskSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot protect private recovery directory.' }
}
function Checked([string]$program, [string[]]$arguments) {
    & $program @arguments
    if ($LASTEXITCODE -ne 0) { throw "Recovery helper failed: $program" }
}
if ($Action -eq 'backup') {
    if (Test-Path -LiteralPath (Join-Path $backup 'SHA256SUMS')) { throw 'Existing recovery set is immutable.' }
    if (-not (Test-Path -LiteralPath (Join-Path $work 'import-scope.json'))) { throw 'Exact approved scope required first.' }
    Add-Type -AssemblyName System.Security
    $environmentBytes = [IO.File]::ReadAllBytes((Join-Path $project '.env'))
    $protectedBytes = [Security.Cryptography.ProtectedData]::Protect($environmentBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [IO.File]::WriteAllBytes((Join-Path $backup 'environment.dpapi'), $protectedBytes)
    $roundTrip = [Security.Cryptography.ProtectedData]::Unprotect($protectedBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $originalHash = [Convert]::ToBase64String($sha.ComputeHash($environmentBytes))
        if ($originalHash -ne [Convert]::ToBase64String($sha.ComputeHash($roundTrip))) { throw 'DPAPI round-trip failed.' }
    } finally { $sha.Dispose() }
    [IO.File]::WriteAllText((Join-Path $backup 'environment.sha256.private.txt'), $originalHash)
    $environmentBytes = $roundTrip = $protectedBytes = $null
    $releaseFiles = @(& git -c core.quotepath=false ls-files --cached --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate matching release.' }
    $releaseFiles = @($releaseFiles | Where-Object {
        $_ -notmatch '^(artifacts|node_modules|vendor|storage|bootstrap/cache|public/storage)/' -and
        ($_ -notmatch '^\.env($|\.)' -or $_ -eq '.env.example') -and
        $_ -notmatch '(^|/)(auth\.json|.*\.private\..*)$' -and
        (Test-Path -LiteralPath (Join-Path $project $_) -PathType Leaf)
    })
    $releaseFiles += @(Get-ChildItem -LiteralPath (Join-Path $project 'public\build') -Recurse -File | ForEach-Object {
        $_.FullName.Substring($project.Length + 1).Replace('\', '/')
    })
    $releaseFiles = @($releaseFiles | Sort-Object -Unique)
    [IO.File]::WriteAllLines((Join-Path $backup 'release-files.private.txt'), $releaseFiles, [Text.UTF8Encoding]::new($false))
    Checked 'C:\Windows\System32\tar.exe' @('-czf', (Join-Path $backup 'release-code.tar.gz'), '-T', (Join-Path $backup 'release-files.private.txt'))
    $head = & git rev-parse HEAD
    [IO.File]::WriteAllText((Join-Path $backup 'release-identity.txt'), "HEAD=$head`nDirty matching code/build captured for exact CONTENT-07B scope; active writer permit excluded.`n")
    Checked 'C:\Windows\System32\tar.exe' @('-czf', (Join-Path $backup 'approved-content.tar.gz'), '-C', $work,
        'approved', 'content-decision.json', 'import-scope.json', 'preflight-report.json', 'preflight-fingerprints.json', 'backup.php', 'restore.php', 'writers.ps1')
    $paused = $false
    try {
        $paused = $true
        Checked 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $work 'writers.ps1'), 'pause')
        Checked 'php' @('-d', 'memory_limit=1024M', (Join-Path $work 'backup.php'))
    } finally {
        if ($paused) { Checked 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $work 'writers.ps1'), 'resume') }
    }
    Write-Output 'Recovery set captured; original services resumed. No migration or import executed.'
    exit 0
}
if (Get-NetTCPConnection -LocalPort 3315 -State Listen -ErrorAction SilentlyContinue) { throw 'Isolated restore port already in use.' }
$dataDir = Join-Path $runtime 'mysql-data'
if (Test-Path -LiteralPath $dataDir) { throw 'Restore datadir must be new; existing recovery data is preserved.' }
New-Item -ItemType Directory -Path $dataDir | Out-Null
$ini = @"
[mysqld]
basedir=C:/OSPanel/modules/database/MySQL-8.0-Win10
datadir=$($dataDir.Replace('\','/'))
port=3315
bind-address=127.0.0.1
mysqlx=0
max_allowed_packet=512M
innodb_buffer_pool_size=512M
innodb_log_file_size=256M
innodb_flush_log_at_trx_commit=2
sync_binlog=0
skip-log-bin
log-error=$($runtime.Replace('\','/'))/mysql-error.private.log
"@
$iniPath = Join-Path $runtime 'my.ini'
[IO.File]::WriteAllText($iniPath, $ini, [Text.UTF8Encoding]::new($false))
$initLog = Join-Path $runtime 'initialize.private.log'
& (Join-Path $mysqlBin 'mysqld.exe') "--defaults-file=$iniPath" --initialize-insecure --console *> $initLog
if ($LASTEXITCODE -ne 0) { throw 'Isolated MySQL initialization failed; private diagnostic retained.' }
$server = Start-Process -FilePath (Join-Path $mysqlBin 'mysqld.exe') -ArgumentList @("--defaults-file=$iniPath") -WindowStyle Hidden -PassThru
try {
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        if ($server.HasExited) { throw 'Isolated MySQL exited.' }
        if (Get-NetTCPConnection -LocalPort 3315 -State Listen -ErrorAction SilentlyContinue) { $ready = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw 'Isolated MySQL did not become ready.' }
    Checked 'php' @('-d', 'memory_limit=1024M', (Join-Path $work 'restore.php'))
} finally {
    $admin = Join-Path $runtime 'admin.private.cnf'
    if (Test-Path -LiteralPath $admin) {
        & (Join-Path $mysqlBin 'mysqladmin.exe') "--defaults-extra-file=$admin" shutdown *> (Join-Path $runtime 'shutdown.private.log')
        if ($LASTEXITCODE -ne 0) { throw 'Isolated shutdown failed; credentials retained privately for recovery.' }
    } elseif (-not $server.HasExited) {
        # Only the process created above, never the main MySQL instance.
        Stop-Process -Id $server.Id -ErrorAction Stop
    }
    if (-not $server.WaitForExit(15000)) { throw 'Isolated MySQL did not stop.' }
    foreach ($file in @('admin.private.cnf', 'client.private.cnf', 'connection.private.json', 'restore.private.sql')) {
        $temporaryPath = Join-Path $runtime $file
        if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath }
    }
}
Write-Output 'Isolated restore verified and server stopped; temporary restore credentials removed.'
