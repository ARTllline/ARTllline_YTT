param([string]$Label = 'receipt-system')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if ($Label -notmatch '^[a-zA-Z0-9-]+$') { throw 'Invalid label' }
$out = Join-Path $PWD ('artifacts\map-engine-performance\' + $Label)
New-Item -ItemType Directory -Force -Path $out | Out-Null
trap { $_.Exception.Message | Set-Content -LiteralPath (Join-Path $out 'error.txt'); break }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Windows requires an elevated PowerShell for CPU/DiskIO ETW profiling.'
}
& wpr.exe -start scripts/qa/receipt-waits.wprp!Receipt.Light *> (Join-Path $out 'start.txt')
if ($LASTEXITCODE -ne 0) { throw 'WPR start failed; existing recording has not been stopped.' }
try {
    # Every insert is rolled back. No scene, account, receipt or permission is persisted.
    $env:YTT_RECEIPT_STOP_MS = '100'
    $env:YTT_RECEIPT_MAX = '10000'
    & 'C:\OSPanel\modules\php\PHP_8.3\php.exe' scripts/qa/receipt-diagnostics.php probe (Join-Path $out 'insert-times.json') --local-admin *> (Join-Path $out 'probe.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Receipt probe failed' }
} finally {
    & wpr.exe -stop (Join-Path $out 'private-system.etl') *> (Join-Path $out 'stop.txt')
    if ($LASTEXITCODE -ne 0) { throw 'WPR stop failed; inspect wpr -status' }
}
