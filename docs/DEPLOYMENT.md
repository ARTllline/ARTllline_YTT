# Self-host deployment — single Ubuntu server

V1 targets one application instance: Nginx → PHP-FPM, MySQL, Redis, a loopback
Reverb listener, database Cue worker and systemd scheduler timer. No Node server
or public storage alias. Start with Ubuntu 24.04 LTS/PHP 8.3; use current security
updates. Test a release on a separate host before updating a live session.

## Dependencies and account

```sh
sudo apt update
sudo apt install nginx mysql-server redis-server php8.3-fpm php8.3-cli php8.3-mysql php8.3-xml php8.3-mbstring php8.3-curl php8.3-zip php8.3-gd php8.3-redis ffmpeg unzip git certbot
sudo systemctl enable --now mysql redis-server php8.3-fpm nginx
```

Install Composer 2 using its verified official installer. Build with Node 20.19+
or a supported newer LTS and `npm ci && npm run build` on your build machine.
Upload the release including `public/build`; Node is not needed for serving it.
Run `composer install --no-dev --prefer-dist --optimize-autoloader` for the release.
Use a deployment account that owns code; www-data only needs read access to code.

Layout: `/srv/ytt/releases/<release>`, symlink `/srv/ytt/current` to that release,
`/srv/ytt/shared/storage` and `/srv/ytt/shared/.env`. Each release symlinks its
`storage` and `.env` to shared paths. For the first release copy its supplied
storage directory to shared storage, preserving `framework/{cache,sessions,views}`
and logs; create `storage/app/campaigns-private`. Do not copy over existing storage.
Make storage and each release's bootstrap/cache writable by www-data:

```sh
sudo chown -R www-data:www-data /srv/ytt/shared/storage /srv/ytt/current/bootstrap/cache
sudo find /srv/ytt/shared/storage -type d -exec chmod 750 {} +
sudo find /srv/ytt/shared/storage -type f -exec chmod 640 {} +
sudo chown root:www-data /srv/ytt/shared/.env
sudo chmod 640 /srv/ytt/shared/.env
```

Create a dedicated MySQL database/user in `sudo mysql`, using a generated password:

```sql
CREATE DATABASE ytt CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'ytt'@'localhost' IDENTIFIED BY 'REPLACE_WITH_RANDOM_PASSWORD';
GRANT ALL PRIVILEGES ON ytt.* TO 'ytt'@'localhost';
```

Privileges are scoped to this database so normal migrations can run. Bind MySQL
and Redis to loopback; expose only SSH/80/443 in the firewall. Set Redis password
if other local users/apps are not trusted; keep protected mode enabled.

## Environment, key and schema

Copy `.env.example` only for a **new** installation. Preserve APP_KEY on updates/restores.
Set the following in shared .env (never in public/build or Git):

```dotenv
APP_ENV=production
APP_DEBUG=false
APP_URL=https://dnd.example.com
DB_CONNECTION=mysql
DB_HOST=localhost
DB_DATABASE=ytt
DB_USERNAME=ytt
DB_PASSWORD=REPLACE_WITH_RANDOM_PASSWORD
SESSION_DRIVER=redis
SESSION_SECURE_COOKIE=true
CACHE_STORE=redis
REDIS_CLIENT=phpredis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
BROADCAST_CONNECTION=reverb
REVERB_SERVER_HOST=127.0.0.1
REVERB_SERVER_PORT=8080
REVERB_HOST=dnd.example.com
REVERB_PORT=443
REVERB_SCHEME=https
REVERB_ALLOWED_ORIGINS=dnd.example.com
REVERB_SCALING_ENABLED=false
FFPROBE_PATH=/usr/bin/ffprobe
TABLETOP_RECEIPT_RETENTION_DAYS=7
TABLETOP_EXECUTION_RETENTION_DAYS=90
```

Generate APP_KEY once with `php artisan key:generate`. Generate missing Reverb app
ID/key/secret with `php scripts/configure-reverb.php`; inspect the resulting public
host/port/scheme values before caching. That script preserves existing credentials.
Both PHP publication and browser WSS must reach the public hostname. Its DNS must
resolve correctly from the server too. Credentials are distinct from APP_KEY.

```sh
cd /srv/ytt/current
sudo -u www-data php artisan migrate --force
sudo -u www-data php artisan config:cache
sudo -u www-data php artisan route:cache
sudo -u www-data php artisan view:cache
```

Keep `queue.connections.tabletop` on the **same MySQL connection** and database,
driver database, `after_commit=false`, queue cues. Do not change it to Redis: run
steps and next jobs commit atomically. Redis serves cache/session, not this queue.

## HTTPS, Nginx and upload limits

Point DNS to the host. Before installing the TLS block, use an HTTP-only bootstrap
server with `server_name dnd.example.com` and an ACME challenge root
`/var/www/letsencrypt`. Then obtain the certificate:

```sh
sudo mkdir -p /var/www/letsencrypt
sudo certbot certonly --webroot -w /var/www/letsencrypt -d dnd.example.com
sudo cp deploy/nginx.conf /etc/nginx/sites-available/ytt
sudo ln -s /etc/nginx/sites-available/ytt /etc/nginx/sites-enabled/ytt
# Edit domain, certificate paths and PHP-FPM socket in the installed file.
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

Add a certificate renewal deploy hook that reloads Nginx. The provided proxy preserves
`/app/` WebSocket and `/apps/` signed publication paths, Upgrade/Connection headers,
Host and forwarded headers; its WebSocket read/send timeout is one hour. Reverb
heartbeats keep the connection active. TLS terminates at Nginx; its PHP-FPM request
has HTTPS set. Do not trust arbitrary forwarded headers from the public internet.
An additional load balancer requires an explicit trusted-proxy configuration.

Install `deploy/php.ini` into the FPM and CLI `conf.d` directories, then reload FPM.
Laravel allows 16 MiB images, 64 MiB audio; PHP upload=64M, POST=68M, Nginx body=68m
leave multipart overhead. Each library upload is one file/request. Image dimensions
remain capped at 8192 per side/32 MP. Test an actual >16 MiB audio upload through HTTPS;
`php -i` only proves CLI configuration. FFprobe must run under www-data; current
OS packages are recommended. Doctor warns for unrecognized nightly version strings.
V1 probing uses local-file protocol only, JSON output and a 10-second timeout.

Never expose `storage/app/campaigns-private` via alias/symlink. `storage:link` is not
needed. Only the public directory is the web root. Keep `public/hot` absent in a release.

## Supervised services

systemd is the recommended process manager. Adjust paths/PHP binary if needed:

```sh
sudo cp deploy/ytt-*.service deploy/ytt-scheduler.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ytt-reverb.service ytt-queue.service ytt-scheduler.timer
sudo systemctl status ytt-reverb ytt-queue ytt-scheduler.timer
sudo -u www-data php artisan tabletop:doctor --production
sudo journalctl -u ytt-queue -u ytt-reverb -u ytt-scheduler --since '10 minutes ago'
```

Queue/Reverb restart after exits/crashes and boot. Queue timeout 60 < retry_after 90;
systemd permits 75 seconds for graceful stopping. Scheduler ticks every minute,
including recover-cues, heartbeat and daily technical cleanup. Do not also install
a duplicate cron schedule. A doctor warning for scheduler clears after the first tick.
Doctor exit 1 means ERROR; WARNING needs operator review. It does not certify live
WSS or worker execution: perform the release checklist with independent browsers.

## Deploy/update and rollback

1. Announce maintenance outside play. Take a consistent backup as BACKUP_RESTORE.md describes.
2. Prepare a separate release with locked dependencies/build; validate without replacing shared .env.
3. `php artisan down`; stop `ytt-queue`, `ytt-reverb`, `ytt-scheduler.timer` and wait for an active scheduler tick to finish.
4. Switch current symlink atomically to the prepared release, then `migrate --force`,
   config/route/view cache and doctor. Do not run destructive automatic rollback migrations.
5. Reload PHP-FPM; start the three services, `php artisan up`, test external HTTPS/WSS,
   invite/join, a Cue, private upload and a Player movement. Check fresh logs.
6. If application rollback is necessary, stop writers again and switch back only if
   the old code supports the new schema. Otherwise restore the matching DB+assets+key
   backup into a fresh database/storage, validate there, then explicitly repoint configuration.

Keep a prior release and backup until acceptance. Never overwrite .env or regenerate
APP_KEY during deployment. Avoid config cache files copied from another host.

## Diagnostic limits and references

`tabletop:doctor` checks DB, Redis, writable directories, private disk placement,
queue configuration/table/backlog, Reverb configuration, PHP extensions, FFprobe,
scheduler heartbeat and CLI limits. It prints no credentials. `/up` only proves
application boot. Inspect log rotation/disk space and failed runs before a session.
Configure Laravel daily logging (`LOG_CHANNEL=daily`, `LOG_DAILY_DAYS=14`).

Configuration reviewed against [Laravel deployment](https://github.com/laravel/docs/blob/13.x/deployment.md),
[Reverb hosting](https://laravel.com/docs/13.x/reverb#running-reverb-in-production),
and [FFprobe options](https://ffmpeg.org/ffprobe.html). Actual environment checks and
remaining deployment limitations are recorded in VALIDATION.md, not inferred from these examples.
