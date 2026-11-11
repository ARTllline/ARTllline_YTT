param([int]$Pairs = 5)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$mysqlBinary = 'C:\OSPanel\modules\database\MySQL-8.0-Win10\bin\mysqld.exe'
$out = Join-Path $PWD 'artifacts/map-engine-performance/receipt-io-boots'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$env:YTT_RECEIPT_MAX = '100'
$env:YTT_RECEIPT_STOP_MS = '0'
for ($i = 0; $i -lt $Pairs; $i++) {
    foreach ($mode in @('unbuffered', 'normal')) {
        $running = @(Get-Process mysqld -ErrorAction SilentlyContinue)
        if ($running.Count -lt 1 -or $running.Count -gt 2 -or @($running | Where-Object Path -NE $mysqlBinary).Count) { throw 'Unexpected MySQL owner' }
        & php.exe scripts/qa/receipt-diagnostics.php shutdown unused --local-admin
        foreach ($process in $running) {
            if (-not $process.WaitForExit(30000)) { throw 'MySQL shutdown timed out' }
        }
        $mysql = Start-Process -FilePath $mysqlBinary -ArgumentList '--defaults-file=C:\OSPanel\modules\database\MySQL-8.0-Win10\my.ini','--performance-schema=ON',("--innodb-flush-method=" + $mode) -WindowStyle Hidden -PassThru
        $ready = $false
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            if ($mysql.HasExited) { throw 'MySQL exited during startup' }
            $client = [Net.Sockets.TcpClient]::new()
            try { $client.Connect('127.0.0.1',3306); $ready = $true } catch {} finally { $client.Dispose() }
            if ($ready) { break }
            Start-Sleep -Milliseconds 500
        }
        if (-not $ready) { throw 'MySQL startup timed out' }
        & php.exe scripts/qa/receipt-diagnostics.php probe (Join-Path $out ("$mode-$i.json"))
        if ($LASTEXITCODE -ne 0) { throw 'Probe failed' }
    }
}
