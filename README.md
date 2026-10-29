# YTT — Your Tabletop

A self-hostable tabletop built around the Game Master's workspace. React owns
the interface, PixiJS draws the table, and Laravel is authoritative for saved
state. The product contract is `AGENTS.md`.

## Local testing with Docker (Windows)

For double-click launch, open Docker Desktop and run **YTT-Start.bat** from the
project root. It waits for the application to be ready and opens the browser.
Run **YTT-Stop.bat** to shut down; campaign data and uploads stay in Docker volumes.

Start Docker Desktop (Linux containers), then run in PowerShell:

```powershell
cd B:\DnD\YTT
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\docker.ps1 up
```

Open **http://localhost:8090** and register an account. The command builds the
application, runs migrations and starts MySQL, Redis, Reverb, the Cue worker and
scheduler. Docker data is separate from the existing local `.env`, database and
uploads. Run the same command after code changes to rebuild the test version.

Replace `up` with `down` to shut down (data stays), `status` to inspect services,
`logs` to follow logs, `doctor` for diagnostics, or `test` to run isolated tests.
See [the Russian Docker tutorial and command reference](docs/DOCKER.md).

## Current status

**Task 14: visual identity, motion and interaction polish.**
The graphite workspace now has semantic mode accents, clearer Session NOW/NEXT and
Combat focus, image-first assets, connected Cue steps and zoom-aware token labels.
Right-click an object (or hold on touch / Shift+F10 on a selection) for contextual
actions. Radial commands use the existing persistence queue; destructive removal
stays outside the menu. Motion respects reduced-motion preferences.
See the [visual report, three passes and 14 screenshots](docs/TASK14_VISUAL_POLISH.md).

**Task 13: canvas-first workspace and live UX redesign.**
Open **Стол** for the map, **Подготовка** for scenes, assets, prefabs, encounters,
cues and automation, **Сессия** for the run-of-show, and **Библиотека** for media.
Settings sit at the bottom of the navigation rail. The Inspector appears after
selection; combat, audio, handouts, players and triggers share one right dock.
On tablet, opening that dock replaces the session drawer. Escape closes an explicit
panel; closing combat restores the selected object's Inspector. Canvas gestures
finish before selection changes the panel layout.

**Ctrl/Cmd+K** searches scenes, cues, encounters, assets, handouts and active session
items. Commands can activate a scene, launch a cue, place an encounter, share a
handout, start/stop music, toggle atmosphere or open a live panel. Arrow keys select,
Enter executes and Escape closes. Scene activation and sharing are explicit commands;
focusing a session item does not execute it. Search returns up to 40 matches per type.

Session notes flush before switching workspace modes. Failed audio commands retain
their original retry identity while the dock remains open. The Player UI stays minimal;
on phones the initiative panel initially shows only the round/current turn.
See the [redesign report and 13 screenshots](docs/TASK13_REDESIGN.md) and
[current validation](docs/VALIDATION.md).

**Task 12 foundation: V1 stabilization candidate.**
The feature set is frozen. GM editing now includes mixed token/prop marquee selection
(Shift toggles intersections), bounded confirmed Undo/Redo, and selective handout
sharing/revocation. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z affect supported layout edits only;
live combat, triggers, audio and presentation are not rewound.
Large-map Fit now zooms below 20%; narrow Player headers wrap audio controls.

Start with [deployment](docs/DEPLOYMENT.md), [backup/restore](docs/BACKUP_RESTORE.md),
[release checklist](docs/V1_RELEASE_CHECKLIST.md), [limits](docs/V1_LIMITATIONS.md)
and [validation evidence](docs/VALIDATION.md). Run `php artisan tabletop:doctor` locally
or `--production` on the release host. A passing local run does not certify a VPS.
There are no new migrations or dependencies in Task 12; rebuild assets and restart
long-running workers. Keep existing `.env`, APP_KEY and campaign storage.

### First session

Create a campaign and scene, upload a map, add/assign tokens, invite players and
activate the scene. Players click **Включить звук** once if audio is wanted. Use
**Горячие клавиши** for tool/selection shortcuts. Prepare **События**, then a **Сессия**
only when useful; the tabletop can be played without a linear plan. Before playing,
check **На связи**, saved state and a test player move. In a handout preview,
**Получатели и доступ** selects recipients or revokes access; **Показать всем** grants
all current players. Downloaded files cannot be recalled.

If a command fails, keep the tab open: **Повторить** reuses its pending command;
**Загрузить сохранённое** explicitly replaces the local draft. Camera movement and
selection themselves do not save or enter Undo history.

### Existing tabletop workflows

Prepare scenes, invite players, move assigned tokens, paint shared manual fog,
measure distances, sketch temporary areas and ping the table. Laravel/MySQL remain
authoritative; Reverb delivers authorized changes. No demo data is automatically seeded.
Prepare combat, enter initiative, advance turns, adjust HP and manage conditions.
Browse reusable private assets, prepare image handouts and place private GM notes.
Place image props, select mixed token/prop groups, and save reusable prefabs and
encounters. Russian is the default UI language; user content and protocol keys
are preserved. Prepare **События** and run server-controlled sequences of object,
encounter, combat, handout, sound and cinematic actions. Regions and game events
can now start those same sequences automatically. Dynamic vision and dice remain deferred.

### When something happens → run a prepared event

Prepare a **Событие** for the scene, then use **Области** in the GM toolbar to draw
a rectangle or circle. Drag to move, pull the selection handle to resize, or enter
coordinates; rename, disable or delete it in the nearby controls. All geometry is
saved in world coordinates. **Показывать области** only changes the local GM view;
it does not disable automation. Regions never appear in Player snapshots or messages.

Open **Триггеры → Добавить триггер** and choose a prepared event plus one of:
**Вход в область**, **Выход из области**, **Взаимодействие с объектом**,
**Сцена активирована**, **Бой начат**, **Новый раунд**. Region filters are
**Любой токен игрока** (default), **Конкретный токен**, or **Любой токен**.
Use **Только один раз**, a pause between launches (0–5 minutes), and an optional
starting round. There is no code editor or second action system. Up to 100 regions
and 100 triggers per scene are supported. Only the active scene fires triggers.

The token footprint is a disc of radius `size × scale / 2`. Touching a rectangle
or circle counts as inside. Only a saved movement from outside to inside, or the
reverse, fires; previews, movement inside, reconnects and geometry edits do not.
A teleport with both endpoints outside does not fire, even if its path crosses the region.

Players select any visible token or prop and press **Взаимодействовать**. Selection
itself does nothing; the button and response do not reveal whether a trigger exists.
Hidden targets are rejected server-side. Object interaction has no distance or
ownership restriction in this version. Locking prevents editing, not interaction.

The server commits the fire and CueRun together under the campaign writer lock.
Two simultaneous entrants cannot consume the same once trigger twice. Once is
consumed when the run is accepted, even if a later Cue step fails. **Разрешить снова**
resets the counter/pause explicitly and retains history. Automatic runs wait behind
the current event; a failed event pauses the queue until Retry/Stop. At 100 unfinished
runs, the originating command is rejected atomically with an actionable error.
**События и очередь** opens the existing run controls from the trigger panel.

Session Mode keeps **Триггеры: N включено** and quick enable/disable available.
The count means enabled definitions, including an already-consumed once trigger.
Automation continues without an open GM browser; the existing Cue queue worker
and scheduler are required. An ancestry limit of eight plus per-correlation trigger
deduplication prevents recursive chains. Deleted references stay visibly unavailable;
removing a trigger does not cancel an already accepted run.

Apply the additive `2026_10_29_001000_create_regions_and_triggers` migration and
restart existing Cue workers when updating an installation. No additional service
or dependency is required. See `docs/ARCHITECTURE.md` and `docs/VALIDATION.md` for
the event contract, privacy boundaries and measured acceptance evidence.

### Plan and run a session

Open **Сессии → Создать сессию**. Add existing scenes, events, handouts and
encounters, plus private notes and chapter dividers. Drag a grip or use Up/Down
to reorder; duplicate/delete individual beats and save the plan. References stay
linked to the original content. Deleted content is marked unavailable; the plan's
notes remain. A campaign supports 100 plans, each with up to 200 items.

**Начать сессию** opens the compact live console and hides preparation chrome.
**Следующий / Предыдущий** and clicking an item change only the saved plan focus.
Use the explicit **Активировать сцену / Запустить событие / Показать игрокам /
Разместить** action to affect the table. Encounters use the existing placement and
**Добавить в бой** workflow. Quick scene/event/handout/encounter access, the top-bar
audio panel and the combat tracker remain available, including out-of-order play.
**Вернуться к редактору** does not end the session.

Session notes autosave after a short pause, with visible save/error state and Retry.
Normal navigation flushes pending notes; closing the browser with unsaved work
prompts a warning. Reload restores the active plan, current item and saved notes.
Only one session can be active per campaign. **Завершить сессию** asks for confirmation,
saves pending notes and retains the plan for review. It does not stop music, end
combat or deactivate the scene. Completed plans are read-only; deleting a plan
never deletes its referenced scenes, events, handouts or encounters.

### Prepare the next scene for Players

In the session console, choose a scene and press **Предзагрузить игрокам**. The
optional **Также аудио её событий** includes that scene's prepared music/ambient/SFX
files, without playing anything. **Автоматически готовить следующую сцену** prepares
images for the nearest later scene in an active plan. Preloading never activates
a scene, runs a cue or changes the current scene state.

The GM sees each Player's waiting/loading/ready/failed status and offline presence.
Players only see a small preparation/retry label. **Активировать сцену** remains
available regardless of readiness. Late joins and reconnects fetch the current
preparation. If the scene changes, prepare it again; batches expire after 30 minutes.

Only images used by visible scene objects and the map are included. Hidden objects
and handouts are excluded. Player manifests contain opaque resource URLs, media
kind and byte size, with no scene title, object data, GM notes, session plan or Cue
definition. **Preloaded files are already delivered to Players and can be inspected**:
opaque names do not hide the content of a map or opted-in audio. Keep genuinely
secret imagery in hidden objects and reveal it when appropriate.

The browser caches at most 128 files / 128 MiB of encoded media in page memory,
downloads with two workers and reuses those bytes for rendering, combat portraits
and audio playback. Reload clears that cache and fetches the current preparation
again; it is not an offline media library. Readiness confirms downloaded bytes,
not GPU decoding or permission to autoplay. Scene activation uses a short dark
transition; Players still control their own camera. Reduced motion is respected.

Existing installations need additive migration
`2026_10_28_000900_create_game_sessions`, a rebuilt frontend, and the existing
Reverb/Cue worker setup. No new dependency, seed, environment replacement or
APP_KEY change is required. See [Architecture](docs/ARCHITECTURE.md) for ownership,
expiry and concurrency limits, and [Validation](docs/VALIDATION.md) for measured
bundle sizes, multiplayer checks and performance results.

### Sound and atmosphere

In **Материалы**, upload **Музыка / Атмосфера / Звуки**. Audio shares the existing
search, tags, collections, rename and batch-upload workflow. Cards show duration;
**Прослушать** is local to the GM and never broadcasts. Audio is not placed on the map.
Open **Звук** in the top bar to select music, add ambient loops or play a one-shot.
Music supports pause/resume, stop, looping and replacement with crossfade. Choose
0 / 0.5 / 1 / 2 / 5 seconds for transitions, and the new playback's relative volume.
Up to four ambient tracks can coexist; stop each independently. Clients cap overlapping
SFX at eight, replacing the oldest if necessary. SFX recordings are limited to two minutes.

**Включить звук** is a real browser gesture that resumes the shared AudioContext.
Until then the current playlist is visible but silent; old SFX are discarded.
Each participant has personal master/music/ambient/SFX sliders stored in browser
storage. These never change anyone else's volume. The GM's **Громкость для стола**
sets the shared mix. The GM can monitor sound or keep their own master at zero.
Browsers may ask for another gesture after reload or audio-device interruption.

Music belongs to the campaign and continues across scene activation/deactivation.
Ambient and visual effects belong to the **current active scene's live session**:
switching or reactivating a scene clears them. They do not automatically return when
going back; use a prepared event to establish that scene's atmosphere. A GM editing
an inactive scene still hears campaign music, but does not see the active scene's weather.
Current music, ambient and weather survive reload/late join/reconnect. Playback seeks
approximately to the server's elapsed time (wrapping loops); this is not sample sync.
SFX have no replay history, including delayed packets crossing a reconnect boundary.

Weather controls provide **Дождь / Снег / Угли / Дымка**, each with three strengths.
They are bounded Pixi decorations, independent of fog, tokens and combat. Reduced
motion uses fewer stationary particles and disables screen flashes. The cue editor
uses the same live-state actions for music, ambient, SFX and weather, plus temporary
colored flash/vignette pulses. Audio fades run concurrently; add **Ожидание** when
the next cue action should wait for a fade to finish. Stopping a cue cancels future
steps; already applied music and weather remain until explicitly changed.

Existing installations need additive migration `2026_10_28_000800_create_live_media`,
a frontend rebuild and the existing Cue worker/scheduler. **FFprobe** must be available
to PHP for audio uploads (`ffprobe` on PATH, or optional `FFPROBE_PATH` pointing to its
executable). No new Composer/npm dependency is required. The server checks detected
MIME, container, codec, channel count and duration: MP3, OGG Vorbis/Opus, WAV PCM
16/24-bit, mono/stereo, up to 64 MiB and two hours. Video/cover-art streams, playlists,
remote URLs and other codecs are rejected. Browser codec support still applies.
Keep FFprobe updated; the application runs it with a fixed argument list, local-file
protocol only and a ten-second timeout. The test suite also exercises FFprobe.

Files stay on the private campaign disk. Players receive only current playback
metadata and authorized media bytes, never an audio library listing or filesystem
path. Range requests support seeking. Continuous tracks grant current access;
SFX/fading-out tracks have short expiring delivery grants. Stopping cannot erase
bytes already buffered by a browser. See Architecture for exact expiry semantics.

### Direct a prepared moment

Open **События → Создать событие**. Name the moment, add actions, select scene
objects or prepared content, then drag the grips to reorder (the Up/Down buttons
also work). Duplicate/delete actions and edit their settings alongside the timeline.
Save the sequence, activate its scene, then press **Запустить**. A running card
shows progress, the current action, **Остановить**, and a visible failed-step retry.
Definitions can be edited on any scene; running always requires the active scene.
Editing or deleting a definition leaves an already started run's snapshot intact.

Supported actions: show/hide tokens and props, move one object, spawn a prefab or
encounter (optionally add/start combat), add tokens to combat, begin/end/next turn,
show a prepared image handout, plaintext message, Wait, camera focus/pan/zoom/shake,
blackout/restore and release. Object coordinates are world coordinates. Camera
focus on an object requires it to be visible; reveal a secret before focusing it.
Messages and camera effects are temporary and never change the scene revision.

**Остановить cancels future actions; it does not undo completed changes.** Scene
activation/deactivation also cancels the campaign's current run. Only one unfinished
run per campaign is allowed, including a failed run awaiting Retry/Stop. Players
can use **Вернуть управление · Esc** to leave the current cinematic locally.
Completion, cancellation, connection loss and scene changes clear presentation.
Reconnect restores scene state, without replaying old cinematic effects.

### Start the event worker

Existing installations need the additive `2026_10_28_000700_create_cues` migration,
rebuilt frontend, and a supervised queue worker. Preserve existing environment and
APP_KEY. This stage uses an explicit **tabletop database queue** on the same database
as scene writes; it works even when the application's default queue is `sync`.

```sh
php artisan migrate
npm run build
php artisan queue:work tabletop --queue=cues --sleep=0.1 --tries=3 --timeout=60
php artisan schedule:work
```

Run the last two commands in separate terminals alongside HTTP/Reverb. Production
may use the usual `schedule:run` every minute instead of `schedule:work`. The
scheduler calls `tabletop:recover-cues` to requeue runs overdue by 90 seconds; the
same command can be run manually after an interruption. Duplicate jobs are harmless.
Restart long-lived workers with `php artisan queue:restart` after code updates and
let the process supervisor start them again. Without a worker, runs remain queued.

Waits persist a due time and enqueue the next step with a delay. Laravel's database
queue uses second timestamps, so a job waits only the final subsecond remainder
(under one second, without database locks) to preserve 250/400/700 ms pauses.
Long pauses leave the worker available. Durations are minimum delays, not hard
realtime deadlines; broker, database and worker load may add latency. Limits:
100 definitions per scene, 50 steps per definition, 60 seconds per Wait and ten
minutes of configured durations per sequence. Run records currently remain until
scene deletion; automatic archival is not implemented.

### Compose and reuse

In **Материалы → Объекты**, upload PNG/JPEG/WebP and drag onto the table. The
Inspector controls position, size, rotation, visibility, locking and stack order.
The corner handle resizes the selected prop; tokens always render above props.
Shift-click on the table or in the scene outline selects several tokens/props.
Drag the group, press Ctrl/Cmd+D to duplicate, or Delete to remove with confirmation.

**Сохранить как заготовку** stores the selection relative to its origin. Drag a
card from **Заготовки** into any scene in that campaign, or click to place at the
viewport center. Spawned objects are independent copies using existing assets.
Select tokens only to **Сохранить как столкновение**. A spawned encounter starts
with full HP and no owners, conditions or combat state; its compact **Добавить в бой**
action uses the existing combat tracker. Definitions remain GM-only. A batch is
limited to 200 objects and commits as one mutation/revision, including safe Retry.

Existing installations need the additive `2026_10_28_000600_create_reusable_content`
migration and a rebuilt frontend. No seed, APP_KEY change or environment replacement
is needed. The backend locale is explicitly Russian, including older `.env` files
that still contain `APP_LOCALE=en`.

## Requirements

- PHP **8.3+**, Composer 2 and Laravel's required extensions, including PDO MySQL
  and fileinfo. **GD with WebP support is required for thumbnails**. Tests also use
  PDO SQLite and GD for generated upload fixtures.
- A dedicated **MySQL** database and **Laravel Reverb** process. File sessions/cache
  and synchronous broadcasts suffice for one application instance. Redis is optional
  until deploying multiple Reverb instances. Events require the database queue worker.
- Node **20.19+** or a supported newer LTS; npm.
- FFprobe on PHP's PATH (or `FFPROBE_PATH`) for validated audio uploads and audio tests.
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
**32 million pixels**, and supported audio up to **64 MiB**. PHP and the web server
must permit that request size: `upload_max_filesize=64M`, `post_max_size=68M`, and
an equivalent proxy body limit. Image limits remain 16 MiB at the application layer.
The stock PHP configuration on some machines allows only 2 MiB.

For a local session without changing system PHP configuration, stop the other
dev server and run the following from the repository root. The working directory
must be `public`, because Laravel's built-in router uses it:

```sh
cd public
php -d upload_max_filesize=64M -d post_max_size=68M -S 127.0.0.1:8000 ../vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php
```

This is a development server, not a public deployment configuration. For hosting,
use `public/` as the web root, HTTPS, `APP_DEBUG=false`, secure session cookies,
application-specific database credentials and writable `storage`/`bootstrap/cache`.

### Private files and backups

Images and audio live under `storage/app/campaigns-private/campaigns/{campaign}/{kind}/`.
They are served only through authorized `/api/assets/{id}` requests. Do **not**
expose this directory through a public alias or storage symlink. `storage:link`
is not needed. Detached images remain in the library until explicitly deleted.
Only unused assets can be deleted; the server checks scene/content references,
current audio grants and cue audio definitions. Removing a definition does not edit
an existing run; deleting a future run's detached audio can make that step fail visibly.
Cached `.thumb.webp` files and their generation locks stay in the same private disk.

Back up the database, private media directory and existing application key
together. Session files are not the canonical scene state.

## Development

Run these processes in separate terminals:

1. `php artisan serve` (or the upload-limit command above).
2. `npm run dev`.
3. `php artisan reverb:start --host=127.0.0.1 --port=8080`.
4. `php artisan queue:work tabletop --queue=cues --sleep=0.1 --tries=3 --timeout=60`.
5. `php artisan schedule:work` (recovery and receipt cleanup).

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

## Preparing a session

Open **Assets** in the left library. Choose All / Maps / Tokens / Handouts, search
by display name, original filename or tag, and combine tag/collection filters.
Recent uploads and Name sorting use pages of 40. Cards request private 320 px WebP
thumbnails, never full-resolution maps. Click a card to rename it, add comma-separated
tags/collections, inspect usage or delete an unused image after confirmation. New
labels create campaign-local tags/collections; removing a label detaches it.
Collections are many-to-many, so one image can belong to several sessions.

Choose an upload type, then drop multiple files into the library or use Upload.
Each file reports its own success/error; a rejected file does not cancel others.
PNG/JPEG/WebP use the same 16 MiB / 8192-side / 32 MP limits. SVG and PDF are not
supported in this stage. Duplicate filenames remain independent assets with generated
private paths. Upload requests are rate-limited to 30/minute per user; large batches
can receive individual retryable failures. Review results before leaving the page.

- Drag a **map** onto the table to use it. Replacing an existing map asks first.
  One asset can be reused by several scenes without another upload.
- Drag a **token image** onto empty space to create a named token at the world
  location, with grid-cell size and normal snap. Drop onto an existing token to
  replace its image; the drop hint names that token. Inspector also offers
  **Choose image from library** and **Choose map from library**.
- Dropping an operating-system file onto the table opens a small Map / Token /
  Handout choice. Uploading from a map-specific control already identifies its use.
- Click a **handout image**, edit its display title/description, then **Prepare /
  Preview**. The full image viewer offers fit, zoom and pan. **Show to Players**
  persistently discovers it for every current Player and opens their viewer live.
  Players can close with Escape and reopen from **Handouts / Discovered**, including
  after reload or scene changes. Later joiners receive it only after another Show.
  Re-show reopens the presentation without duplicate discovery records. A missed
  live presentation is repaired as discovery on reconnect or the 15-second probe.
- Choose **Note**, then click the map. Edit title, plaintext body and marker type in
  the compact private editor. Body edits debounce 450 ms through the same save queue;
  closing the editor does not discard pending edits. Drag a marker to save one move
  on release. **Show GM Notes** only toggles local presentation. Notes draw above fog
  for the GM and never enter Player snapshots, events, private file grants or UI.

Library metadata and handouts are campaign-level. Scene maps, token images and
notes use normal scene revisions; library organization does not advance the scene.
Handout images are private before discovery. Originals and thumbnails share current
usage authorization; knowing an old URL does not bypass hiding/replacement. Bytes
already received cannot be erased from another browser's memory.

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
| Add/replace map                    | Scene setup / Assets library / explicit file-drop choice  |
| Token image, owner, hidden, locked | Selected token's Inspector                                |
| Delete token/scene                 | Contextual action with confirmation                       |
| Switch campaign/scene              | Campaign picker / Scenes sidebar                          |
| Set live scene                     | Separate Activate/Deactivate button                       |

The status bar shows **Сохранено**, **Сохранение…**, or a Russian save failure.
Failed writes retain local edits and stop the queue. Use **Повторить**, or explicitly
discard unconfirmed edits by reloading the saved state. In-app navigation waits for saving;
closing/reloading a dirty tab asks for confirmation. Pending edits are memory-only
and do not survive a forced close. This is not an offline editor.

**На связи / Переподключение / Нет связи** reports transport status separately from saving.
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
