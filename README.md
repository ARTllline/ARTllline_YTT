# YTT — Your Tabletop

A self-hostable tabletop built around the Game Master's workspace. React owns
the interface, PixiJS draws the table, and Laravel is authoritative for saved
state. The product contract is `AGENTS.md`.

## Current status

**Task 03: realtime multiplayer and a dedicated Player View.** Prepare a campaign,
invite your party, activate a scene and move assigned tokens together. Reverb
delivers authorized incremental changes and temporary movement previews; Laravel
and MySQL remain authoritative. Reload/reconnect restores the current scene.
The existing GM workspace, private images and persistence remain intact.

Fog, measurements, initiative, audio and cues are deferred. There is no automatic
demo data or seeded account.

## Requirements

- PHP **8.3+**, Composer 2 and Laravel's required extensions, including PDO MySQL
  and fileinfo. Tests also use PDO SQLite and GD for generated upload fixtures.
- A dedicated **MySQL** database and **Laravel Reverb** process. File sessions/cache
  and synchronous broadcasts suffice for one application instance. Redis is optional
  until deploying multiple Reverb instances; no queue worker is required here.
- Node **20.19+** or a supported newer LTS; npm.
- A WebGL-capable browser. Desktop/laptop is the primary GM target.

## Install and run

From the repository root:

```sh
composer install
cp .env.example .env
php artisan key:generate
npm ci
```

On PowerShell use `Copy-Item .env.example .env`. Copy the environment and generate
a key only for a **new installation**; preserve an existing `.env` and `APP_KEY`.
Create a dedicated database (the example uses `ytt`) and set `DB_HOST`,
`DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` and `APP_URL` in `.env`. Then run:

```sh
php artisan migrate
php scripts/configure-reverb.php
npm run build
php artisan serve
```

Open **http://127.0.0.1:8000** and register your own account. Migrations create
schema only. No seeding is required. The registration → campaign → scene → map →
token workflow requires no manual domain rows. Start Reverb in another terminal:

```sh
php artisan reverb:start --host=127.0.0.1 --port=8080
```

The setup script generates missing Reverb app credentials and selects the Reverb
broadcaster. It preserves the application key and existing Reverb credentials.
Do not commit `.env`. Client connection settings are read from `/api/session`;
only the public key/host/port/scheme reach the browser.

### Upload limits

The application accepts PNG/JPEG/WebP up to **16 MiB**, **8192 px per side** and
**32 million pixels**. PHP and the web server must permit that request size:
`upload_max_filesize=16M`, `post_max_size=20M`, and an equivalent proxy body limit.
The stock PHP configuration on some machines allows only 2 MiB.

For a local session without changing system PHP configuration, stop the other
dev server and run the following from the repository root. The working directory
must be `public`, because Laravel's built-in router uses it:

```sh
cd public
php -d upload_max_filesize=16M -d post_max_size=20M -S 127.0.0.1:8000 ../vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php
```

This is a development server, not a public deployment configuration. For hosting,
use `public/` as the web root, HTTPS, `APP_DEBUG=false`, secure session cookies,
application-specific database credentials and writable `storage`/`bootstrap/cache`.

### Private files and backups

Images live under `storage/app/campaigns-private/campaigns/{campaign}/{kind}/`.
They are served only through authorized `/api/assets/{id}` requests. Do **not**
expose this directory through a public alias or storage symlink. `storage:link`
is not needed. Detached images are retained for future reuse, not garbage-collected.

Back up the database, private image directory and existing application key
together. Session files are not the canonical scene state.

## Development

Run **three processes** in separate terminals:

1. `php artisan serve` (or the upload-limit command above).
2. `npm run dev`.
3. `php artisan reverb:start --host=127.0.0.1 --port=8080`.

Open the Laravel URL, not the Vite URL. Stop Vite and run `npm run build` to use
the production bundle. Remove a stale `public/hot` only if a terminated Vite
process left it behind. Both dependency lockfiles are checked in.

### Invite and play

1. Open **Players** in the GM toolbar; create an invitation with an expiry and
   optional maximum number of new players. Copy the link; it is shown only once.
2. Open it in another browser profile/incognito context. Sign in or register;
   the auth flow returns to the invitation. Join with the existing account.
3. The Player View waits until the GM activates a scene. Set **Controlled by**
   in a token's Inspector to assign it to the player.
4. Players drag only their visible, unlocked tokens. The pale dot/ring marks
   movable tokens; selection explains whether a token is yours or view-only.
5. GM editing another prepared scene does not move players. **Activate** does.

The Players panel shows membership and live presence without exposing emails.
Revoking an invitation prevents future joins; it does not remove existing members.
Player campaigns open at `/campaigns/{id}/play`. The Player View has independent
pan/zoom/selection and no GM Inspector or preparation controls.

### Realtime hosting settings

Local defaults use `127.0.0.1:8080` over WS. For LAN/VPS access set `APP_URL` to the
reachable application URL, `REVERB_HOST`/`REVERB_PORT`/`REVERB_SCHEME` to the public
WebSocket endpoint and `REVERB_ALLOWED_ORIGINS` to comma-separated **hostnames**.
An HTTPS application needs WSS (`REVERB_SCHEME=https`, normally port 443).
Reverse-proxy Reverb's `/app` and `/apps` paths with WebSocket upgrade support;
keep the internal listener on an appropriate private interface and supervise both
PHP and Reverb. Clear cached config and restart Reverb after changing its settings.
The PHP publisher must also be able to reach the configured Reverb endpoint.
Client-originated Reverb events are disabled; movement previews use authorized HTTP.

## Controls and saving

| Action                             | Control                                                   |
| ---------------------------------- | --------------------------------------------------------- |
| Select a token                     | Click the token or scene outline                          |
| Move an unlocked token             | Drag with Select; save once on drop                       |
| Pan                                | Middle mouse, Pan tool, or Space + drag on focused canvas |
| Zoom                               | Wheel toward cursor; +/- buttons; Fit scene               |
| Edit properties                    | Inspector; numeric/text fields commit on Enter or blur    |
| Cancel a draft/drag                | Escape                                                    |
| Grid calibration                   | Grid toolbar; short save debounce                         |
| Add/replace map                    | Scene setup upload or drop an image on the tabletop       |
| Token image, owner, hidden, locked | Selected token's Inspector                                |
| Delete token/scene                 | Contextual action with confirmation                       |
| Switch campaign/scene              | Campaign picker / Scenes sidebar                          |
| Set live scene                     | Separate Activate/Deactivate button                       |

The status bar shows **Saved**, **Saving…**, or **Save failed**. Failed writes
retain local edits and stop the queue. Use **Retry**, or explicitly discard
unconfirmed edits with **Reload saved**. In-app navigation waits for saving;
closing/reloading a dirty tab asks for confirmation. Pending edits are memory-only
and do not survive a forced close. This is not an offline editor.

**Live / Reconnecting / Offline** reports transport status separately from saving.
HTTP saves can succeed while Reverb is unavailable. Recovery subscribes again and
loads an authoritative snapshot; a lightweight 15-second revision check repairs
an otherwise missed final broadcast. Player movement pauses while disconnected
or syncing. Rejected player moves restore saved state and show a readable error.
Retries reuse mutation IDs, including an ambiguous create/delete response.

World positions use token centers in map pixels, independent of the camera.
Snap places centers at cell centers only on drop. Inspector coordinates stay
exact. Locked tokens remain selectable; unlock before dragging. Hidden tokens
are dimmed for the GM and absent from Player snapshots.

## Checks

```sh
composer test
npm run test
npm run typecheck
npm run lint
npm run build
php vendor/bin/pint --test
composer validate
composer check-platform-reqs
```

PHP feature tests use an isolated in-memory SQLite database and fake private
storage, never the configured working MySQL campaign database. Browser acceptance
also exercises real MySQL. See [Validation](docs/VALIDATION.md) for evidence and
limits; [Architecture](docs/ARCHITECTURE.md) documents routes, contracts, permissions,
revision locking, renderer integration and next-stage decisions.
