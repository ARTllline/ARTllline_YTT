$ErrorActionPreference = 'Stop'
$targets = @(
    'C:\OSPanel\userdata\ytt-receipt-qa-8046\ytt-flush-probe.private.tmp',
    (Join-Path $PWD 'artifacts/receipt-mysql-runtime/ytt-flush-probe.private.tmp')
)
$rows = @()
for ($round=0; $round -lt 5; $round++) {
    foreach ($target in $targets) {
        if (Test-Path -LiteralPath $target) { throw 'Probe file already exists' }
        $bytes = [byte[]]::new(4096)
        $file = [IO.FileStream]::new($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough)
        try {
            $file.SetLength(65536)
            $file.Flush($true)
            for ($i=0; $i -lt 100; $i++) {
                $clock = [Diagnostics.Stopwatch]::StartNew()
                $file.Position = ($i % 16) * 4096
                $file.Write($bytes,0,$bytes.Length)
                $file.Flush($true)
                $rows += [pscustomobject]@{ drive = $target.Substring(0,1); round=$round; ms=$clock.Elapsed.TotalMilliseconds }
                Start-Sleep -Milliseconds 20
            }
        } finally {
            $file.Dispose()
            Remove-Item -LiteralPath $target
        }
    }
}
$rows | ConvertTo-Json | Set-Content -LiteralPath artifacts/map-engine-performance/receipt-flush-probe.json
