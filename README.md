# YTT — Your Tabletop

A self-hostable, browser-based tabletop designed around the Game Master's
workspace. React handles the application UI; PixiJS renders the tabletop; Laravel
provides the web application foundation. Product direction lives in `AGENTS.md`.

## Current status

**Task 01: foundation + renderer vertical slice.** One original demo scene with
four tokens, camera pan/zoom, square grid calibration, selection, drag, snapping
and a two-way Inspector. Custom dark workspace, collapsible panels, responsive
overlays, shortcut help, loading states and error recovery are included.

This is a local renderer preview. Changes reset on reload. Multiplayer, scene
persistence, campaign CRUD, authentication, upload, fog and cues are not built.
Disabled controls and prototype panels identify future capabilities honestly.

## Requirements

- PHP **8.3+** and Composer 2 (Laravel 13 platform requirements).
- PHP extensions required by Laravel, including mbstring, OpenSSL, PDO, tokenizer,
  XML/DOM, fileinfo, ctype, curl; use `composer check-platform-reqs` to verify.
- Node **20.19+** (or supported newer LTS), npm.
- A browser with WebGL enabled. Desktop/laptop is the primary GM target.

MySQL and Redis are the intended future backend services. Neither is needed for
this preview: sessions/cache use files and no route queries the database.

## Install

Run from the repository root:

```sh
composer install
cp .env.example .env
php artisan key:generate
npm ci
npm run build
php artisan serve
```

On PowerShell use `Copy-Item .env.example .env` instead of `cp`. Copy the environment
file and generate a key only on first installation; preserve an existing `.env`
and `APP_KEY`. Open **http://127.0.0.1:8000**. No migration is needed for this stage.

Configure `APP_URL` if using another local hostname. `.env.example` has an empty
key and database password; `.env`, dependencies and generated builds are ignored.
When database features arrive, configure a dedicated MySQL database before
running their migrations. Do not use the development server for public hosting;
the production web root will be `public/` with `APP_DEBUG=false`.

## Development

Use two terminals:

```sh
php artisan serve
# or: composer dev
```

```sh
npm run dev
```

Open the Laravel URL, not the Vite server URL. Vite supplies assets and React HMR.
To use a production bundle, stop Vite and run `npm run build`. If Vite was killed
uncleanly, remove its stale `public/hot` file so Laravel uses the build manifest.

## Checks

```sh
composer test
php vendor/bin/pint --test
npm run typecheck
npm run lint
npm run test
npm run build
```

`npm run format` formats authored frontend files and documentation with Prettier.
`composer validate` and `composer check-platform-reqs` check backend packaging.
Both dependency lockfiles are included for reproducible installation.

## Controls

| Action                        | Control                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| Select token                  | Click it, or select it in the scene outline                    |
| Move token                    | Drag with Select tool; 3 px threshold                          |
| Pan                           | Middle mouse drag, Pan tool, or Space + drag on focused canvas |
| Zoom toward cursor            | Mouse wheel                                                    |
| Fit scene                     | Frame icon beside zoom percentage                              |
| Cancel drag / clear selection | Escape                                                         |
| Change grid / snap            | Grid tool; visibility and snap are independent                 |
| Edit selected token           | Inspector; commit fields with Enter or blur                    |
| Cancel numeric draft          | Escape                                                         |
| Shortcut reference            | Shortcuts button in status bar                                 |

Positions are token centers in world pixels. Snap places centers at cell centers
when dropped; the cell outline previews the destination. Inspector coordinates
remain exact. Rotation changes the token's directional emblem while its name
stays readable. No delete action is provided until a recovery/undo workflow exists.

## Source map

```text
routes/web.php                   Laravel entry route
resources/views/workspace.blade.php
resources/js/app.tsx             React entry + error boundary
resources/js/workspace/          Shell, Inspector, toolbar and lifecycle adapter
resources/js/tabletop/
  renderer/                     Pixi lifecycle, camera and pointer controller
  layers/                       Map, grid, props, tokens and interaction overlay
  objects/                      Token presentation
  state/                        Demo fixture and local observable scene store
  types/                        Scene, token, camera and grid contracts
  utils/                        Pure coordinate and snapping math
resources/css/                  Design tokens and workspace styles
tests/Feature/                  Laravel route smoke tests
```

The renderer uses direct Pixi updates for raw movement, a sampled transient
Inspector preview, and one committed scene mutation on drop. React subscribes
through `useSyncExternalStore`; camera and scene data remain separate. No global
state dependency or speculative multiplayer infrastructure is introduced.

Read [Architecture](docs/ARCHITECTURE.md) for data flow, lifecycle and next-stage
integration boundaries, and [Validation](docs/VALIDATION.md) for actual checks,
responsive coverage and the manual acceptance checklist.

All scene artwork and token emblems are original vector primitives in this
repository. UI icons use Lucide (ISC); there are no external image/font requests.
