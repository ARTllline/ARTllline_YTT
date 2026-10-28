# YTT — Your Tabletop

A self-hostable tabletop built around the Game Master's workspace. React owns
the interface, PixiJS draws the table, and Laravel is authoritative for saved
state. The product contract is `AGENTS.md`.

## Current status

**Task 02: persistent campaigns and scenes.** Register, create a campaign and
scene, upload a map, calibrate the grid, add tokens, edit them and return later.
The prepared world survives reload and sign-out. Editing a scene is independent
of activating it for future players.

Session authentication, GM/Player memberships, policies, filtered snapshots,
private image delivery and atomic scene revisions are implemented. Player UI,
invitations, realtime, fog, measurements, audio and cues are intentionally deferred.
There is no automatic demo data or seeded account.

## Requirements

- PHP **8.3+**, Composer 2 and Laravel's required extensions, including PDO MySQL
  and fileinfo. Tests also use PDO SQLite and GD for generated upload fixtures.
- A dedicated **MySQL** database. File sessions/cache and synchronous actions are
  sufficient at this stage; Redis/Reverb are not needed.
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
npm run build
php artisan serve
```

Open **http://127.0.0.1:8000** and register your own account. Migrations create
schema only. No seeding is required. The registration → campaign → scene → map →
token workflow requires no manual domain rows.

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

Run Laravel (one of the commands above) and `npm run dev` in separate terminals.
Open the Laravel URL, not the Vite URL. Stop Vite and run `npm run build` to use
the production bundle. Remove a stale `public/hot` only if a terminated Vite
process left it behind. Both dependency lockfiles are checked in.

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
