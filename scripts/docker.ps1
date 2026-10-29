param(
    [ValidateSet('up', 'down', 'stop', 'status', 'logs', 'doctor', 'test')]
    [string]$Action = 'up',
    [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot '.env.docker'

function New-RandomBase64 {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}

function Invoke-Compose {
    & docker compose --project-directory $projectRoot --env-file $configPath @args
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed (exit $LASTEXITCODE)." }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Install Docker Desktop with the Linux containers / WSL 2 backend first.'
}

if (-not (Test-Path -LiteralPath $configPath)) {
    if ($Action -ne 'up') { throw 'Run .\scripts\docker.ps1 up first.' }
    $config = [IO.File]::ReadAllText((Join-Path $projectRoot '.env.docker.example'))
    $config = $config.Replace('GENERATE_APP_KEY', ('base64:' + (New-RandomBase64)))
    foreach ($placeholder in @('GENERATE_DB_PASSWORD', 'GENERATE_ROOT_PASSWORD', 'GENERATE_REVERB_KEY', 'GENERATE_REVERB_SECRET')) {
        $config = $config.Replace($placeholder, (New-RandomBase64))
    }
    [IO.File]::WriteAllText($configPath, $config, (New-Object System.Text.UTF8Encoding $false))
    Write-Host 'Created .env.docker with unique local credentials. Keep this file with your Docker data.'
}

$engineType = & docker info --format '{{.OSType}}' 2>$null
if ($LASTEXITCODE -ne 0 -or $engineType -ne 'linux') {
    throw 'Start Docker Desktop with Linux containers, wait for Engine running, then repeat this command.'
}

switch ($Action) {
    'up' {
        Invoke-Compose up --build --detach --wait --wait-timeout 180
        $appUrl = (Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^APP_URL=' }) -replace '^APP_URL=', ''
        Write-Host "YTT is ready: $appUrl"
        if ($OpenBrowser) { Start-Process -FilePath $appUrl }
    }
    'down' { Invoke-Compose down }
    'stop' { Invoke-Compose stop }
    'status' { Invoke-Compose ps --all }
    'logs' { Invoke-Compose logs --follow --tail 80 }
    'doctor' { Invoke-Compose exec --user www-data app php artisan tabletop:doctor }
    'test' {
        # Fresh containers have no shared storage volume; tests cannot touch private uploads.
        # Override process env explicitly: phpunit.xml alone does not replace Docker env.
        & docker run --rm --user www-data --tmpfs /var/www/html/storage:uid=33,gid=33,mode=1777 `
            --entrypoint sh ytt-local:dev -c 'mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs; APP_ENV=testing DB_CONNECTION=sqlite DB_DATABASE=:memory: DB_URL= CACHE_STORE=array SESSION_DRIVER=array QUEUE_CONNECTION=sync BROADCAST_CONNECTION=null MAIL_MAILER=array APP_KEY=base64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= php vendor/bin/phpunit --fail-on-warning'
        if ($LASTEXITCODE -ne 0) { throw 'PHP tests failed.' }
        Invoke-Compose run --build --rm --no-deps frontend npm run test
    }
}
