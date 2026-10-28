# YTT — Your Tabletop

A self-hostable tabletop built around the Game Master's workspace. React owns
the interface, PixiJS draws the table, and Laravel is authoritative for saved
state. The product contract is `AGENTS.md`.

## Current status

**Task 05: combat at the table, on the persistent multiplayer foundation.**
Prepare scenes, invite players, move assigned tokens, paint shared manual fog,
measure distances, sketch temporary areas and ping the table. Laravel/MySQL remain
authoritative; Reverb delivers authorized changes. No demo data is automatically seeded.
Prepare combat, enter initiative, advance turns, adjust HP and manage conditions.
Dynamic vision, dice, encounters, audio, cues and the larger asset library remain deferred.

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
Client-originated Reverb events are disabled; movement and spatial previews use authorized HTTP.

`REVERB_SERVER_HOST`/`REVERB_SERVER_PORT` configure the listener;
`REVERB_HOST`/`REVERB_PORT` configure the endpoint used by PHP and, in this app,
the browser. Preserve `/app` (WebSockets) and `/apps` (signed HTTP publication)
when proxying; do not rewrite both to Laravel's front controller. Forward HTTP/1.1,
Host, Upgrade and Connection headers for WebSocket connections. Use a loopback
upstream such as `127.0.0.1:8080`, rather than `0.0.0.0` as a destination.
These recommendations were reviewed against [Laravel Reverb's hosting guide](https://laravel.com/framework/docs/13.x/reverb#web-server).
No production proxy was deployed or tested.

For live groups use a properly configured PHP web server with OPcache. The Windows
single-process development server without OPcache showed substantial HTTP latency
in the local load check. See Validation for measured limits; Redis alone does not
fix PHP command latency. To enable an installed OPcache extension for a local
process only, add `-d zend_extension=/absolute/path/to/opcache -d opcache.enable_cli=1
-d opcache.validate_timestamps=1 -d opcache.revalidate_freq=0` to the PHP command.
Use the platform's actual extension path; this is optional, not an install dependency.

## Spatial tools

The compact toolbar is shared by GM and Player, with Fog and Grid settings available
only to the GM. Keyboard shortcuts: **V** Select, **H** Pan, **F** Fog (GM), **R** Ruler,
**P** Ping. **Space + drag** temporarily pans; **Escape** cancels the gesture/own
measurement and returns to Select. Shortcuts do not run while editing fields.
Choose Circle / Cone / Rectangle from the area tool's contextual selector.

- **Fog:** Reveal or Cover with a brush (diameter 30–600 world px) or a rectangle.
  The brush outline previews its size. Cover all / Reveal all require confirmation
  and replace the old history. New scenes start clear. A stroke previews locally
  and saves once on release; cancellation saves nothing. GM sees covered areas at
  reduced opacity; Player sees an opaque cover. Reload and reconnect restore it.
- **Ruler:** drag from start to end. Distances use Euclidean world geometry and the
  scene grid's distance per cell (default **5 ft**, also **m** and **squares**).
  Measurement snap uses cell centers, including grid offsets; turn it off for exact
  positions. It is independent of token drop snap and camera zoom.
- **Areas:** circle radius, 60° cone length, or rectangle width × height. These are
  temporary spatial aids, with no spell, movement-cost or combat rules.
- **Sharing:** one current measurement/area/ping per participant. Drag updates are
  sampled at 12.5 Hz with HTTP backpressure. Finished measurements/areas last five
  seconds; pings pulse for 2.2 seconds. Escape clears your own overlay. Pings never
  move anyone's camera. Replacing an overlay replaces only that participant's aid.
  Prepared-scene GM measurements stay local; only the active scene is shared.

**Fog is visual concealment, not an authorization boundary.** Visible tokens under
fog still exist in the Player snapshot and can be inspected by a determined client.
Use **Hidden** for secrets: hidden tokens remain absent from Player snapshots,
private image access and broadcasts, regardless of the fog geometry.

## Combat at the table

1. Open the collapsible **Combat** panel and choose **Prepare Combat**. Preparation
   stays private to the GM, including on the active scene. **Add combatants** searches
   scene tokens and accepts several at once; Inspector also adds/removes its token.
2. Enter initiative inline (Enter or blur). Values may have two decimal places.
   Preparation sorts descending, with unset values last and stable ties. Drag a row's
   grip to set order; focused grips also support Up/Down. Editing initiative during
   preparation sorts again. During active combat it preserves the manual order;
   use **Re-sort by Initiative** explicitly when wanted.
3. **Begin Combat** starts round 1 at the first row. Next/Previous wrap rounds;
   Previous never goes below round 1. Select a row for **Make current**, Damage/Heal
   and conditions. New combatants append; removing the current one chooses its next
   remaining neighbor without changing round. Empty combat stays active until End.
4. Damage/Heal apply the entered magnitude; Enter in the adjustment field applies its
   signed value. These are atomic server deltas. Set exact HP and maximum HP in the
   Inspector. HP stays between zero and maximum; decreasing maximum clamps current HP.
   Zero HP has a subdued bar, with no automatic death, removal or skipped turn.
5. Add a built-in condition or a custom label (40 characters; up to 30 per token).
   Conditions persist until removed. The eye control switches public/GM-only;
   even token owners never receive GM-only conditions. Duplicate names are normalized.
   The map shows up to three abbreviated diamond badges plus an overflow count;
   selection and the tracker show the full permitted list. Presets do not apply rules.
6. **End Combat** asks for confirmation, clears turn indicators and the Player tracker,
   and retains HP, conditions and the ended combat record. No history browser yet.

Players see only active combat, visible participants, initiative, round and current
turn. An owned token says **Your Turn**; an undisclosed current participant says
**GM Turn** without its identity or order position. Exact HP is provided only for
the player's own tokens, including locked ones. Players cannot edit HP, conditions
or combat. Their compact tracker can collapse to the current turn.

Next/Previous include the expected round/current participant. A stale command from
another GM window returns a conflict and restores current state; it does not advance
again. Buttons pause while a command saves. Lost HTTP responses retain the original
mutation UUID in the save queue, so **Retry** cannot double damage or advance twice.
Reload/reconnect restore the authoritative combat snapshot. Ordinary changes do not
produce success toasts. Hidden remains the security boundary; fog still conceals pixels.

## Receipt retention

Scene command receipts default to **7 days** (`TABLETOP_RECEIPT_RETENTION_DAYS`,
minimum one day). This is far longer than the memory-only browser retry window.
After pruning, a very old UUID is no longer deduplicated: reload saved state before
retrying commands kept open beyond that window. No scene/token/fog data is pruned.

```sh
php artisan tabletop:prune-receipts --dry-run
php artisan tabletop:prune-receipts
```

The command is scheduled daily with overlap protection. For unattended cleanup,
configure the normal Laravel scheduler (`php artisan schedule:run` every minute),
or use `php artisan schedule:work` locally. The scheduler does not start itself.
The command deletes only completed receipts older than the configured cutoff;
`created_at` is indexed. It is safe to run repeatedly. This is not archival storage.

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
