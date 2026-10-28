# Architecture — renderer vertical slice

## Application boundary

One Laravel 13 repository. `GET /` renders a small Blade entry document; Laravel's
Vite integration loads React. There is no second SPA server in production, no
Inertia dependency, authentication, scene API or database-backed editor yet.
`/up` is the framework health route. Standard Laravel configuration/migrations
remain available for future work, but this stage does not execute migrations.

The prototype needs neither MySQL nor Redis to boot. `.env.example` targets
MySQL for the future domain and uses file sessions/cache and synchronous queues
today. It must not be mistaken for an authoritative multiplayer backend.

## React and Pixi

React owns the workspace chrome, navigation, Inspector forms, grid controls,
shortcuts dialog and loading/error UI. `Tabletop.tsx` owns only the renderer
lifecycle. It dynamically imports the renderer so the shell can load first.

PixiJS owns the scene graph and artwork. `TabletopRenderer` assembles layers,
subscribes to local scene changes, handles container resizing and releases
resources on unmount (including React StrictMode's asynchronous setup/cleanup).
It exposes only `fit`, `zoom`, `setTool` and lifecycle operations to the UI.

Layer order:

1. Application clear color — viewport background.
2. `MapLayer` — original fixed vector observatory, clipped to its bounds.
3. `GridLayer` — square grid, only rebuilt when calibration changes.
4. `PropLayer` — decorative vegetation, rubble and braziers.
5. `TokenLayer` / `TokenView` — token bodies, directional emblems, HP, names.
6. `InteractionLayer` — preview of the drop cell.

Token selection rings live with their views. All scene layers share a single
world container; toolbar and panels are ordinary accessible HTML. Map artwork
is a fixed demo illustration, not a procedural map generation feature.
Future layers should be introduced when a real workflow requires them.

## Coordinates and camera

World units are logical map pixels; the demo is 1440 × 1080. Token `x`/`y`
represent the **center**. Size is an unscaled diameter, scale is uniform, and
rotation is in degrees. Camera translation is in CSS pixels and zoom is unitless:

```text
screen = world × zoom + camera translation
world = (screen − camera translation) / zoom
```

All conversion/snap math lives in `tabletop/utils/coordinates.ts` with pure
tests. Canvas backing resolution is separate, capped at DPR 2. The camera is
renderer-local, not scene data. Resizing preserves the viewport's world center
and all token coordinates; it cancels an in-progress drag rather than changing
the pointer's relationship to the token. Fit is an explicit camera operation.

Wheel deltas are normalized and bounded. Zoom eases exponentially toward a
target (20–300%). Every animation step preserves the world point at the cursor.
Reduced-motion preference applies immediately without easing. Pan uses screen
deltas; token drag divides screen deltas by zoom and preserves the grab offset.

## State ownership

`SceneStore` is a small instance scoped to one workspace. No Redux/Zustand or
global singleton is needed. Its immutable snapshots are consumed by React with
`useSyncExternalStore` and by the renderer through the same subscription API.
Token edits normalize rotation, validate finite numbers, bound scale and HP,
and preserve unchanged token identities so their graphics need not be rebuilt.

There are deliberately separate kinds of state:

| State                                      | Owner                    | Lifetime                      |
| ------------------------------------------ | ------------------------ | ----------------------------- |
| Tokens, grid, dimensions                   | `SceneStore.scene`       | Local demo session            |
| Selected IDs                               | `SceneStore.selectedIds` | UI selection; not domain data |
| Latest sampled drag preview                | `SceneStore.preview`     | Transient Inspector readout   |
| Raw pointer, grab offset, hover, camera    | Renderer/controllers     | Transient presentation        |
| Panel visibility, active tool, open dialog | React                    | Workspace UI                  |

Selection uses an ID collection but currently accepts one object. This is a
clear extension point, not an implementation of multi-select.

Movement flow:

```text
pointerdown → capture pointer + select
pointermove → move Pixi TokenView directly
            → publish latest Inspector preview at most every 80 ms (with trailing update)
pointerup   → snap center if enabled → commit one domain update → clear preview
cancel / Escape / window blur / lost capture → restore domain position
```

The React workspace does not receive every raw pointer movement. Inspector
coordinates are read-only during preview. Preview is explicitly excluded from
domain state. A future persistence adapter should consume committed operations,
not subscribe indiscriminately to every UI notification.

Snap aligns a token's center to the nearest cell center, including grid offset
and negative cells. The token follows the cursor freely during a drag; a cell
outline previews its landing position. Snap occurs only on drop. Exact Inspector
coordinates bypass snap, and changing grid calibration never moves objects.
Grid visibility and snapping are independent controls.

## Interaction and failure handling

Native Pointer Events use pointer capture and a 3 px drag threshold. Primary
mouse, touch and pen share one gesture controller. Pan tool, middle drag, or
Space while the canvas is focused pan the camera without moving tokens. Wheel
zoom is ignored during a drag. Keyboard handling does not capture text/number
editing. Escape cancels an active drag and clears selection; Escape inside a
number field discards its draft. Inputs commit on Enter/blur.

React has an application error boundary. Async renderer initialization errors
and WebGL context loss show a readable recovery overlay; diagnostics are logged
to the browser console. Reload is the recovery path, and local demo edits are
explicitly described as temporary. Listeners, timers, ResizeObserver and Pixi
resources are released on teardown.

## Design and responsive layout

Custom CSS tokens define surfaces, text, borders, accent, danger, selection,
GM-only color, spacing, radius, shadows, typography and motion. Lucide is the
single shell icon set; the token emblems are original Pixi artwork. No external
fonts or third-party image assets are loaded.

Desktop uses grid columns with collapsible side panels. Inspector becomes an
overlay below 1180 px; library becomes an overlay below 900 px. Crossing those
breakpoints closes the relevant panel. Narrow screens open one overlay at a
time. Resize handles/docking and a complete mobile editor are deferred. Native
dialog gives focus trapping and Escape dismissal for shortcut help.

## Next integration seam

The next vertical slice should introduce Laravel application actions and
membership/visibility policies before exposing any player snapshot. Persisted
objects will be server-authoritative. Replace the demo fixture with a filtered
snapshot and reconcile accepted incremental commands, keeping camera/hover/
selection/preview local. Plan command IDs, scene revision/conflict handling and
reconnect resynchronization together. Hidden objects must be filtered in both
HTTP snapshots and broadcasts; a client `hidden` property is not security.

The current command-like `updateToken` boundary is intentionally small. It can
be augmented for undo or authoritative reconciliation without event sourcing.
No speculative transport, generic entity framework or plugin layer is present.

## Current limitations

- Edits reset on reload; no autosave claims, localStorage or server persistence.
- No multiplayer, player view, ACL, invites, upload, fog, audio, cues or CRUD.
- One demo scene, four tokens, single selection; decorative props are not editable.
- No deletion, undo/redo, group transforms, pinch zoom or resizable panel handles.
- Browser QA covers Chromium; Safari/Firefox and real touch hardware need future QA.
- GPU context loss requires reload. Long canvas labels abbreviate at 24 characters;
  full names remain available in the outline and Inspector.

Reference APIs: [Laravel 13 installation](https://laravel.com/docs/13.x/installation),
[PixiJS application lifecycle](https://pixijs.com/8.x/guides/components/application).
