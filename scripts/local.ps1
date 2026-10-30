param(
    [ValidateSet('start', 'stop', 'status', 'doctor', 'test')]
    [string]$Action = 'start',
    [switch]$OpenBrowser,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$runtime = Join-Path $projectRoot 'artifacts\local-runtime'
$statePath = Join-Path $runtime 'processes.json'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE)." }
}

function Get-OwnedProcess($entry) {
    $process = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
    if ($process -and $process.StartTime.ToUniversalTime().Ticks.ToString() -eq $entry.started) {
        return $process
    }
    return $null
}

$entries = @()
if (Test-Path -LiteralPath $statePath) {
    # Windows PowerShell 5.1 emits JSON arrays as one pipeline object.
    $entries = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
}

if ($Action -eq 'stop') {
    foreach ($entry in $entries) {
        if (Get-OwnedProcess $entry) {
            # artisan serve and schedule:work have children; stop only the recorded tree.
            & taskkill.exe /PID $entry.pid /T /F | Out-Null
            if ($LASTEXITCODE -ne 0 -and (Get-OwnedProcess $entry)) { throw "Could not stop $($entry.name)." }
        }
    }
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
    Write-Host 'YTT processes stopped. Local MySQL and saved data are unchanged.'
    exit 0
}
if ($Action -eq 'status') {
    $rows = foreach ($entry in $entries) {
        [PSCustomObject]@{ Service = $entry.name; PID = $entry.pid; Running = [bool](Get-OwnedProcess $entry) }
    }
    $rows | Format-Table -AutoSize | Out-Host
    if (-not $entries.Count) { Write-Host 'No YTT processes started by this helper.' }
    exit 0
}

$php = (Get-Command php -ErrorAction Stop).Source
$localIni = Join-Path $PSScriptRoot 'php'
if ($env:PHP_INI_SCAN_DIR) {
    $env:PHP_INI_SCAN_DIR += [IO.Path]::PathSeparator + $localIni
} else {
    # An empty first entry preserves PHP's compiled default scan directory.
    $env:PHP_INI_SCAN_DIR = [IO.Path]::PathSeparator + $localIni
}
if ($Action -eq 'doctor') {
    Invoke-Checked $php @('artisan', 'tabletop:doctor')
    exit 0
}
if ($Action -eq 'test') {
    Invoke-Checked $php @('artisan', 'config:clear')
    Invoke-Checked $php @('artisan', 'test')
    Invoke-Checked 'npm.cmd' @('run', 'test')
    exit 0
}

if (-not (Test-Path -LiteralPath '.env')) { throw 'Configure .env first; see docs/LOCAL_DEVELOPMENT.md.' }
$settings = @{}
foreach ($line in Get-Content -LiteralPath '.env') {
    if ($line -match '^([A-Z0-9_]+)=(.*)$') { $settings[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'") }
}
if ($settings.APP_ENV -ne 'local') { throw 'This launcher is only for APP_ENV=local.' }
$url = [Uri]$settings.APP_URL
if ($url.Host -notin @('localhost', '127.0.0.1') -or $url.Scheme -ne 'http') { throw 'Use a loopback http APP_URL for this local launcher.' }
$reverbHost = $settings.REVERB_SERVER_HOST
if ($reverbHost -notin @('localhost', '127.0.0.1')) { throw 'REVERB_SERVER_HOST must be loopback for local development.' }
$reverbPort = $settings.REVERB_SERVER_PORT
if (-not $reverbPort) { $reverbPort = '8080' }
$definitions = @(
    @{ name = 'app'; args = @('artisan', 'serve', '--host=127.0.0.1', "--port=$($url.Port)") },
    @{ name = 'reverb'; args = @('artisan', 'reverb:start', "--host=$reverbHost", "--port=$reverbPort") },
    @{ name = 'queue'; args = @('artisan', 'queue:work', 'tabletop', '--queue=cues', '--sleep=0.1', '--tries=3', '--timeout=60') },
    @{ name = 'scheduler'; args = @('artisan', 'schedule:work', '--no-interaction') }
)
$live = @($entries | Where-Object { Get-OwnedProcess $_ })
if ($live.Count -eq $definitions.Count) {
    Write-Host "YTT is already running: $url"
    if ($OpenBrowser) { Start-Process -FilePath $url.AbsoluteUri }
    exit 0
}
if ($live.Count) { throw 'Some YTT processes are still running. Run local.ps1 stop, then start.' }
foreach ($port in @($url.Port, [int]$reverbPort)) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        try { $client.Connect('127.0.0.1', $port) } catch { }
        if ($client.Connected) { throw "Port $port is already in use; stop its owner or change .env." }
    } finally { $client.Dispose() }
}
Invoke-Checked $php @('artisan', 'optimize:clear')
Invoke-Checked $php @('artisan', 'migrate', '--no-interaction')
if (-not $SkipBuild) { Invoke-Checked 'npm.cmd' @('run', 'build') }
$entries = @()
try {
    foreach ($definition in $definitions) {
        $process = Start-Process -FilePath $php -ArgumentList $definition.args -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime ($definition.name + '.log')) -RedirectStandardError (Join-Path $runtime ($definition.name + '.error.log'))
        $entries += [PSCustomObject]@{ name = $definition.name; pid = $process.Id; started = $process.StartTime.ToUniversalTime().Ticks.ToString() }
        $entries | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    }
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        foreach ($entry in $entries) {
            if (-not (Get-OwnedProcess $entry)) { throw "$($entry.name) exited; see $runtime." }
        }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri ($url.AbsoluteUri.TrimEnd('/') + '/up') -TimeoutSec 2
            $socket = New-Object Net.Sockets.TcpClient
            try { $socket.Connect('127.0.0.1', [int]$reverbPort) } finally { $socket.Dispose() }
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw "YTT readiness timed out; see $runtime." }
    Write-Host "YTT is ready: $url"
    if ($OpenBrowser) { Start-Process -FilePath $url.AbsoluteUri }
} catch {
    foreach ($entry in $entries) {
        if (Get-OwnedProcess $entry) { & taskkill.exe /PID $entry.pid /T /F | Out-Null }
    }
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
    throw
}
