# MapWorld foundation — MAP-01

Scene remains the owner of gameplay/runtime state. A Scene may have one MapWorld;
existing scenes are not backfilled or converted by the additive migration.

## Persistence and coordinates

`map_worlds` contains a unique scene FK, schema version (currently 1), an optional
small normalized reference crop rectangle, and timestamps. Scene dimensions remain
the canonical bounds, starting at world origin (0, 0). The MapWorld DTO exposes
those dimensions as `bounds`; there is no second writable copy of dimensions.
The current Scene map placement and square grid also remain canonical Scene fields.
No geometry revision is needed until a geometry consumer exists.

Tokens/props retain their world coordinates when bounds, reference or grid change.
Shrinking checks full token discs, rotated prop footprints, Regions and GM notes.
An invalid shrink rejects the entire command. Nothing is moved or deleted.
Legacy scenes retain their previous resizing behavior until MapWorld is enabled.

## Preparation workflow

Use **Редактор карты** in the scene header to enter preparation tools over the
existing Pixi viewport. **Выйти из редактора** in the same place returns to the
scene. The editor toolbar groups Terrain, Build, Objects and Lighting separately
from Materials, LOS, Layers, map settings and camera/history controls.
Frequently used controls sit below the toolbar. The right dock shows a palette or
the active selection, with exact settings available on demand. Build material
pickers retain recent choices within the editor, and LOS can stay visible while
working in Build. Lighting and map settings have explicit save actions.

The settings button opens the foundation and grid panel. Local settings draft preview uses
the existing background/grid, Camera and PointerController. It is not scene state
and is not broadcast. Pan with Space + drag; ordinary entity editing is suspended.

The GM can keep the current image, pick another map from Global Assets, or use a
blank world. Position, proportional scale, exact width/height, center/fit and crop
are available. Crop is a normalized visible rectangle within the positioned full
image; it hides edges without stretching the image or changing the source Asset.
Changing the image through the old map endpoint clears the previous image's crop.

Grid calibration uses two image-grid intersections along one grid line and the
known number of cells between them. The first point defines grid offset; distance
divided by cell count defines cell size. Numeric adjustment, distance units and
snapping remain available. Grid calibration never rescales world entities.

Save commits bounds, map/crop and grid together. Editing an active Scene affects
Players after Save; there is no separate draft/published-world subsystem.

## Commands, history and synchronization

`POST /api/scenes/{scene}/map-world` accepts an expected settings snapshot and the
new value. It requires campaign GM permission, checks schema compatibility, validates
asset access/bounds/crop, and uses SceneTransaction and the existing mutation receipt.
A successful command produces one Scene revision and one `map-world.updated` patch.
The settings compare-and-set is independent of unrelated token/combat revisions.

SceneStore → ScenePersistence → SaveQueue is the normal save path. Validation and
conflict rejection preserve the local draft and release the queue. Ambiguous network
failure retains its mutation UUID for Retry. Server-accepted create/update is one
step in the existing bounded SceneHistory. Its inverse uses the same settings
validation through edit-history, without replaying gameplay actions.

Undo of initial creation can remove this foundation record and restore the previous
settings. Future MAP entities must extend that inverse's dependency checks before
adding world-owned data. This is not a general public delete-world operation.

Scene snapshots include `mapWorld: null` or bounds; GM snapshots additionally include
schemaVersion. Players receive rendering bounds and reference crop, not authoring
settings/version. Existing private scene channels, epochs, revision gap recovery and
reconnect snapshots carry all changes. No manifest/chunk protocol or new channel.
Manual Fog remains visual masking and does not authorize hidden data.

Scene duplication copies MapWorld/crop independently with the existing layout copy.
The normal Session uses the same renderer and does not expose the editor surface.

## Validation

- `MapWorldTest`: migration compatibility, atomic settings, assets, bounds/footprints,
  permissions, safe player events, persistence, duplication, Undo/Redo and conflicts.
- `mapWorld.test.ts` and SceneSubscriber tests: local draft, queued save, terminal
  rejection, calibration, Undo/Redo, ordered patches and reconnect hydration.
- `node scripts/qa/map01.cjs`: native Chromium GM/Player workflow on permanent scene
  5, including blank world, reload, Session and settings restoration in `finally`.
  It reads credentials only from the existing ignored private account file. Evidence
  is ignored under `artifacts/map01/`; no accounts/scenes/sessions are created.

Terrain, materials, structures, collision, LOS, Fog v2 and lighting are outside MAP-01.
Existing explicit Pixi layers provide insertion points for later map layers; no empty
renderer subsystems or future data tables have been added.

## MAP-02 editor core

The editor is a preparation-only React overlay on the existing TabletopRenderer,
not a second canvas or runtime. Objects use SceneProp, AssetPicker, PlacementOverlay,
ObjectGesture, snapping, selection/marquee, ScenePersistence/SaveQueue and the existing
SceneTransaction/revision/event pipeline. Tokens remain dim context and cannot be
selected/moved by map editor gestures. Camera state survives panel changes.

V selects, H pans, Space + drag temporarily pans, wheel zooms, Escape cancels placement
or selection. Ctrl/Cmd+D duplicates, Delete confirms removal; Ctrl/Cmd+Z and
Ctrl/Cmd+Shift+Z undo/redo. Ctrl/Cmd+S flushes normal autosaves; foundation settings
still require their explicit Save button. Inspector supports name, position, size,
rotation, order and the existing Scene-level player visibility/object lock.

Background and Objects have local editor visibility; Objects additionally has a
local edit lock. These settings live only in WorkspaceSnapshot.mapEditor, survive
reconnect reconciliation, and are reset when leaving the editor. They never enter
commands, Scene serialization, player projections or collision state. Background is
edited explicitly in settings; Terrain/Structures have no actionable layer controls
until there is real content. Fog/notes/regions are suppressed locally while editing.

Confirmed prop Inspector and ordering changes extend the existing bounded history.
Decorative prop create/duplicate/delete inverses use server-encrypted snapshots,
scoped to the same Scene and identity. Apply compares the complete captured layout
and rechecks dependencies inside SceneTransaction. A new loot container, interaction,
trigger or object-check history blocks an inverse delete. Such game-linked props and
mixed token/prop lifecycle edits do not get presence history; delete confirmation
explains the limit. Transforms retain the normal field-level compare-and-set history.
Presence snapshots are returned only to the authoring request, never broadcast.
History remains local to the current tab and clears on full reload.
Rejected editor object commands reconcile the authoritative snapshot, explain the
error, and release the save queue. Ambiguous network failures retain the existing
mutation identity and show Retry, using the normal queue/receipt behavior.

## MAP-02 material definitions

`map_materials` is a personal GM library, shared across that user's campaigns through
`/api/library/materials`. `map_material_versions` stores immutable definition versions:
name, terrain/floor/wall type, private Asset FK, repeat width in world-coordinate units,
base rotation, and optional offset/quarter-turn variation flags. Repeat height follows
the original image aspect ratio. The picker previews the base repeat/rotation at a
stated world-unit-to-pixel scale; variation flags are metadata for later placement.
There is no painting or build tool in MAP-02.

Create/Edit/Duplicate/Delete use ownership checks and existing mutation receipts.
Edit compares the expected version, then appends a new version instead of overwriting
the previous definition. Textures must belong to the personal Asset Library; a GM
can duplicate a campaign Asset into that library first. Private asset delivery stays
behind the existing AssetPolicy. Creating a material grants no player asset access.
Referenced texture Assets cannot be deleted or replaced (including old versions);
choose a new Asset for a changed texture. Library material deletion cascades versions;
consumer FKs must restrict deleting any version in use. A synthetic consumer-FK test
verifies the deletion contract without adding terrain tables.

**Required for MAP-03:** coverage must reference an immutable `map_material_versions.id`
with RESTRICT ON DELETE, never resolve an existing placement through the mutable
library head. Derive deterministic variation from placement data. All new world-owned
terrain data must also extend the initial MapWorld-creation inverse dependency check
before shipping; MAP-02 materials are user-owned and props remain Scene-owned, so no
new MapWorld deletion dependency exists yet. Player rendering projections and private
texture access for actually placed terrain must be designed together in MAP-03.

Validation: MapEditorPropsTest, MapMaterialTest and mapEditor.test.ts protect history,
ownership, private textures, version conflict/deletion, and local editor state. The
native `scripts/qa/map02.cjs` smoke reuses the permanent GM/Player contexts and fixture,
checks placement/Inspector/history, layers, material create/edit, reconnect/reload,
settings and Session isolation, then deletes its temporary props/material/asset copy.
Evidence is ignored under `artifacts/map02/`. MAP-01 smoke follows the new settings
entrypoint and continues to cover blank worlds and calibration.

## MAP-03A — editable terrain foundation

Terrain is optional MapWorld-owned coverage, rendered between the reference image
and grid/props/tokens by the existing TabletopRenderer, in Preparation and Session.
Players receive rendering data only. The Terrain panel is available only to the GM
in Map Editor. It uses the same PointerController: Paint/Erase capture the pointer,
Space/middle drag pans, wheel zooms, V/H switch away, and Escape/blur/pointercancel
discard an unfinished stroke. The circular cursor uses world-space diameter.
Brush settings and previews are local presentation state; completed strokes autosave.

### Data and resolution decision

`terrain_chunks` has a unique `(map_world_id, x, y)` and SHA-256 content hash.
Each chunk spans **256 × 256 world units**, independent of grid/camera. Separate
`terrain_masks` rows contain **128 × 128 unsigned alpha bytes** per material version
(2 world units per sample), zlib-compressed and base64-wrapped **only for SQL text
storage**. There is no canonical RGB image, canvas-sized texture, or stroke replay.
Empty masks/chunks are removed immediately; loading reads current masks directly.

At this resolution each unsqueezed mask is 16 KiB. A 128-world-unit chunk would
quadruple manifest/draw-call count for the same painted area; a 512-unit chunk would
quadruple the area recomposited for a local change. 256 is the initial compromise,
with one sample per 2 units and a 4-unit minimum brush. This is a version-1 mask
format, not a resolution derived from grid size or the user's current zoom.

Every mask has a real FK to immutable `map_material_versions.id`, **RESTRICT ON
DELETE**. New library versions never alter existing terrain. The first-MapWorld
creation inverse rejects removal while terrain exists. Bounds shrink checks actual
occupied mask samples and rejects cropping coverage. Scene duplication copies masks
independently, retaining the same immutable definitions.

Coverage stores premultiplied material weights with a total of at most 255 per
sample. Paint replaces a fraction of all existing weights with the selected
material. This allows painting any material over another without material-order
surprises. Erase reduces **all terrain weights**, revealing the reference/blank
background. Integer remainder allocation preserves total coverage when blending.
It does not approximate erasure by painting a background colour.

### Brush and render pipeline

1. Pointer positions become world coordinates and are quantized to 1/4 unit.
   Spatial samples are spaced by at least `max(2, diameter / 12)`; release includes
   the final endpoint. Segments form continuous capsules, so sparse events do not
   leave dab gaps. Movement sampling is independent of the render ticker.
2. The PHP and TypeScript v1 rasterizers evaluate sample-centre distance to each
   segment, quantize distance to 1/256 unit, and apply a linear soft falloff.
   Each stroke uses **maximum influence**, not repeated opacity accumulation.
   Collinear event subdivision and repeated points produce the same mask bytes;
   matching PHP/JS golden hashes protect the numerical contract.
3. A dedicated worker processes ordered pointer samples in batches, independently of
   the render ticker. The GM client coalesces dirty masks by chunk, applies up to
   two preview masks per frame, and loads up to four missing base chunks concurrently.
   Preview uses the captured hashes and never changes canonical Scene state. Escape
   terminates the worker and drops its draft, including while release is draining.
4. TerrainLayer lazily fetches masks over authorized HTTP (up to four background
   requests), and decodes source images down to at most 1024 pixels on the long edge.
   Material repeat width/aspect, rotation and version-seeded variation share a
   **single world-space phase**, never a per-chunk random seed.
5. Small disposable Canvas2D composites become Pixi CanvasSource textures. A 260 px
   backing includes a two-unit gutter on every side; the 256 px interior is drawn.
   Gutter masks read neighbouring chunks, so interpolation agrees across boundaries.
   Weighted textures add as premultiplied coverage, then compose normally over the
   background. RGB tiles are derived caches, not the editable source.
6. Only dirty tiles and affected neighbours are recomposited, with at most four
   derived texture updates per frame. Offscreen GPU tiles are destroyed. Sources
   are allocated directly, avoiding a global Texture.from cache retaining canvases.
   Unused ImageBitmaps are closed; in-flight work is aborted at renderer teardown.

The painter can soften a coverage edge; it cannot repair a seam inside a source
image that was not authored as a tileable texture. Repeat-scale detail is limited
by the source decode cap and the one-world-unit derived RGB pixel resolution.

### Transactions, history and access

`POST /api/scenes/{scene}/terrain` submits one compact polyline with settings,
immutable material version, expected hashes for affected chunks, and the normal
mutation UUID. ScenePersistence/SaveQueue submits once per completed stroke.
SceneTransaction locks the campaign/scene, checks GM permission, material ownership,
format, bounds, CPU/resource limits and per-chunk compare-and-set, then commits
one revision and `terrain.updated`. Unrelated combat/token edits or disjoint chunks
do not make a stroke stale. Conflicting touched chunks reject the entire operation.
Definitive failures release the queue; ambiguous failures keep the UUID for Retry.

Snapshots contain a compact terrain manifest, version rendering definitions, and
chunk hashes/version IDs. Incremental events contain only changed descriptors and
required definitions. **No RGB images, alpha masks or history snapshots travel
over WebSocket.** `GET /api/scenes/{scene}/terrain/{x}/{y}?hash=…` supplies alpha bytes
as hexadecimal JSON over private, no-store HTTP. A stale hash returns 409 and
triggers snapshot recovery. Normal epochs/revision gaps/reconnect use the existing
SceneSubscriber; there is no additional channel or scene-wide broadcast per dab.

Only the authoring HTTP result includes encrypted, scene-bound before/after
mask snapshots for the normal SceneHistory. Undo/Redo restores exact bytes through
edit-history after checking the touched hashes; it never replays combat, token,
loot or trigger actions. History remains tab-local and clears on full reload,
as in MAP-02; the reloaded terrain is still editable and starts new history.
Redo also survives Undo/Redo of foundation creation (which changes its database
ID): the current Scene, format, bounds and expected chunk hashes remain checked.
Deleting a now-unused material version can invalidate an older local inverse;
it rejects safely rather than substituting the library head.

ScenePolicy gates mask reads. AssetPolicy grants placed texture access to campaign
GMs and to players **only while used in their active scene**; removing the last
coverage or deactivating the scene revokes that grant. Merely defining a material
still grants no player access. Player projections omit names/library/owner metadata
and all history capabilities. Terrain is public scene artwork, not a secret layer;
manual Fog remains visual masking, consistent with existing map images.

### Long strokes and resource limits

The original per-segment bounding rectangle included much of the space outside
diagonal capsules. Even an exact retrace revisited all candidates and repeated
distance and alpha calculations. A 1024-wu dab tests roughly 263,000 candidates
before clipping, so roughly eight overlapping dabs could exhaust the 2M budget.
The 512-point and 32-touched-chunk ceilings could reject independently.

The two rasterizers now restrict candidate blocks to the capsule's horizontal band.
An 8 × 8 block uses conservative distance bounds and its minimum accumulated alpha
to skip work, or applies uniform influence when both bounds quantize to the same
alpha. Exact retraces in either direction reuse their existing coverage. Mixed
blocks still evaluate the original per-sample falloff wherever the candidate could
improve alpha. For wide soft brushes, the supporting plane of the distance function
can prove an existing sample alpha cannot improve even on a slightly shifted retrace. Erase skips chunks without terrain. Empty paint bases directly use
the coverage mask. Laravel independently rasterizes the compact polyline and uses
the same atomic compare-and-set and history protocol.

- Diameter 4–1024 wu, softness 0–255, strength 1–255.
- A gesture can submit up to 8,192 sampled points, enough for 120 seconds at 60
  accepted samples per second. Its work meter charges one unit
  per candidate block, one per eight inspected cells (rounded up per block), and
  one per exact sample-distance calculation. At 24M units, another distinct
  segment is disallowed. A single accepted segment can cross the work threshold.
- A stroke can touch the full 256-chunk world allocation. The painter stops
  accepting new segments at a resource limit, shows a notice and saves the accepted
  prefix on release as one normal edit. Escape still cancels the entire draft.
- The 8-material-per-chunk, 32-version-per-world and 1.5M-character encrypted
  snapshot caps remain. Stale hashes and server-side validation or snapshot errors
  reject atomically. Ambiguous responses use the existing receipt retry.
- A raw worker coverage mask and block minima cost about 4.1 MiB at 256 chunks,
  excluding point/message queues and base/preview masks. Each decoded layer is
  16 KiB. Each resident derived tile costs about 264 KiB on CPU and GPU. Existing
  offscreen tile disposal and bitmap lifetime rules still apply. These are upper
  bounds for those allocations, separate from measured process memory.

Median raster-only times on native Windows PHP 8.3 and headless Chromium, with
the same quantized polylines and brush settings in both runtimes (7 samples per
case after browser warmup):

| Scenario                             | Chunks after | Chromium before → after |  PHP before → after |
| ------------------------------------ | -----------: | ----------------------: | ------------------: |
| Diagonal 32 wu                       |            7 |            1.9 → 0.4 ms |       19.7 → 6.2 ms |
| Diagonal 180 wu                      |           11 |            5.3 → 1.2 ms |      49.2 → 29.2 ms |
| Diagonal 1024 wu                     |           27 |           31.4 → 7.5 ms |    267.6 → 229.0 ms |
| Curved erase influence, 180 wu       |           31 |           48.9 → 9.7 ms |    437.7 → 283.6 ms |
| Repeat the same 1024-wu pass         |           24 |       rejected → 5.3 ms | rejected → 161.0 ms |
| Zigzag 1024 wu                       |          131 |      rejected → 29.7 ms | rejected → 897.9 ms |
| Zigzag/retraces, 720 points, 1024 wu |          134 |      rejected → 31.6 ms | rejected → 954.8 ms |

These measurements exclude alpha application, SQL, HTTP, encrypted history,
composition and texture upload. The first four cases retained identical coverage hashes before and after.
All seven updated Chromium and PHP hashes match. A separate 934-point pressure
trace with slightly varied passes and a wide soft brush covered 157 chunks and
took 11.7 seconds in standalone PHP. Native single-process HTTP can delay other
requests during a save of that size.
The standalone PHP benchmark includes alpha application and zlib compression.

### Validation and review boundary

`TerrainTest` covers exact paint/erase overlap and Undo/Redo, immutable versions,
receipts, stale reads/writes, private permissions and access revocation, atomic
conflicts, gameplay isolation, bounds/dependencies and independent duplication.
`terrain.test.ts` covers deterministic masks, falloff/weights, pattern phase,
resource budget, one-command queue/history, rejection, reconnect and cancellation.

`node scripts/qa/map03a.cjs` reuses scene 5 and separate permanent GM/player contexts.
It temporarily uploads two deterministic tileable diagnostic textures, paints a
meadow/path with real mouse gestures, checks exact masks across zoom/pan, Undo/Redo,
Erase/cancel, reload editing, reconnect events, player access and Session. It restores
all terrain/settings, deletes its temporary materials/assets, and verifies that
tokens/props/combat match the baseline. No replacement scene/account/session is made.
Screenshots and timing/request evidence are ignored under `artifacts/map03a/`.

Set YTT_LONG_STROKE=1 in PowerShell to also run a 65-second held-pointer 1024-wu
zigzag/retrace on temporarily enlarged bounds. Set it to 120 for two minutes, or
jitter for a 65-second series of slightly varied curved passes.
The script checks one autosave, more than 512 points and 32 chunks, exact
Undo/Redo, stale-write rejection and player reload. Artifacts are under
artifacts/terrain-long/browser/. The 65-second run saved 2,569 points and 116
chunks in one edit. The two-minute zigzag run saved 4,793 points and 116 chunks,
and its stale replay returned HTTP 409. The final 65-second varied-curve run saved
934 points across 157 chunks and had a 16.7 ms p95 frame interval while drawing.
All runs restored the fixture. The varied-curve report and screenshots are under
artifacts/terrain-long/browser-jitter/.

The 2026-11-03 Chromium run passed with fixture restoration and no JavaScript
errors. Identical strokes at 69% and 96% zoom and after Space-pan produced identical
chunk hashes. Across three offscreen pan/return cycles WebGL counters rose from
62 created / 0 deleted to 89 created / 27 deleted: 62 active both times. In the
workflow window including painting, median frame interval was 8.3 ms, p95 16.6 ms,
and maximum 33.3 ms (headless Chromium; not a device/GPU performance guarantee).
Stroke requests were 465–1,620 bytes; authoring responses including encrypted Undo
data were about 56–185 kB. Those history bytes are excluded from WebSocket events.

Automated validation: 61 backend tests / 716 assertions across Terrain, MapWorld,
Materials, editor props, ScenePreparation and Combat; all 249 frontend tests; lint
and production build passed. Build retains the existing unresolved divider asset
and large bundle warnings.
The existing MAP-01 and MAP-02 browser smokes also passed and restored the fixture.
Review images: `terrain-editor.png`, `terrain-live-preview.png`,
`terrain-zoom-cursor.png`, `terrain-reload.png`, `terrain-player.png` and
`terrain-session.png`, all under `artifacts/map03a/`.

**MAP-03B has not started and requires review.** Follow-up candidates: validate
the initial resolution and limits with real large maps and lower-end GPUs; profile
and move composition/raster work off the main thread if measurements justify it;
improve texture loading/retry UX and authoring ergonomics; review whether larger
worlds require LOD/cache paging or a different alpha wire encoding. Decorative
scatter, noise/edge presets and other deferred MAP-03 scope remain separate work.

## Terrain Painter — visual refinement

The editable samples, worker stroke batching and one-edit history contract remain
the MAP-03A format. The display interpolates all material weights at the same
slightly displaced world-space position. This gives the transition an irregular
edge while preserving combined coverage. A 272 px backing uses eight world units
of gutter on each side, sampling adjacent masks. The Terrain layer clips to the
canonical MapWorld bounds. Empty areas show the reference image or the neutral
MapWorld surface.

The material's repeat width is still set in the GM Material Library. Terrain
surfaces blend two repeats of the same tileable texture at different scales and
angles, with smoothly varying world-space weights. Painted Floor materials use
the second repeat only when offset variation is enabled. Both repeats use the
same immutable material version and line up across chunk boundaries.

The brush starts with a narrower feather. The outer cursor marks the diameter
and the inner ring marks the full-strength core. **[** and **]** change size,
**E** toggles Paint/Erase, and size, softness and opacity are remembered in this
browser. The palette searches the GM Material Library by surface type (Terrain
or Floor) and highlights the chosen version.

Preview tiles are considered first. The upload loop retains its four-tile cap and
checks a six-millisecond CPU allowance between completed tiles. One tile can exceed
the allowance. Offscreen GPU tiles are disposed and stale decoded masks are removed
as their hashes change. A 272 px RGBA backing is about 289 KiB each on CPU and GPU,
or about 72 MiB on each if all 256 tiles are resident. Eight decoded 16 KiB masks
per chunk add up to 32 MiB at that limit, excluding source textures and browser
overhead. The 256-chunk, 8-layer and history/work budgets remain in force.

Run the native fixture smoke with **YTT_TERRAIN_ART=1** for three compositions
at 29%, 50% and 100% zoom. Artifacts go to `artifacts/terrain-art/`.
Use **YTT_LONG_STROKE=jitter** in the same run to check a held-pointer pressure trace,
release-to-response time, Player reload and GPU disposal. The optional
`php scripts/qa/terrain-benchmark.php --capacity` exercises a 4096 × 4096 world
(256 chunks), eight existing layers per chunk, rasterization, mask blending and
compression without SQL, network or history serialization.

On the native Chromium/PHP 8.3 fixture, the 65-second pressure stroke saved
934 points and 157 chunks in one edit. The drawing frame interval was 8.4 ms
at p95 and release to HTTP response took 8.30 s. Undo/Redo and Player reload
matched the saved hashes. Three pan cycles destroyed 27 GPU textures and the
net live texture count returned to its starting value. The 256 × 8 standalone
capacity case spent 1.76 s rasterizing. Hoisting the PHP blend loop invariants
reduced application plus compression from 6.18 s to 4.29 s for that case.
The pressure trace and capacity case exercise different work profiles.

An isolated Chromium capacity run supplied 256 chunks with eight masks each via
intercepted HTTP responses. The canvas appeared at 2.14 s and all 256 derived
tile textures had uploaded by 8.33 s. Reloading the real fixture view after
removing the intercepts took 1.40 s to canvas. These are local render and decode
measurements with 64 MiB of mock JSON, excluding database and production latency.

## MAP-04 — Build, стены и комнаты

Build в Map Editor поддерживает стены полилинией, одиночный сегмент,
прямоугольную комнату и произвольный простой контур. Полилиния и контур
завершаются Enter или двойным кликом, контур также можно замкнуть на первой
точке. Esc сбрасывает незавершённый жест. Сегмент и прямоугольник поддерживают
два клика или перетаскивание. В режиме «Правка» GM выбирает стены, комнаты,
вершины и проёмы.
Удаление комнаты сохраняет её стены. Удаление ребра или вершины удаляет также
полы, у которых разорван контур. Undo возвращает всю топологию и пол.

### BUILDER-01 — инструменты, направляющие и материалы

Панель Build под инструментами редактора показывает настройки активного
инструмента. В «Правке» инспектор появляется после выбора стены, комнаты,
вершины или проёма. Материалы стены и пола выбираются по текстурным превью
из GM Material Library. Поиск ограничен типом поверхности, четыре последних
выбора каждого типа доступны, пока открыт Build.

Приоритет привязок при рисовании идёт от общей вершины к середине сегмента
и проекции на ось стены, затем к направляющей и узлу сетки. Если узел лежит
на активной направляющей, используются обе привязки. Основной радиус — до
10 экранных пикселей с ограничением в 45% клетки. У середины радиус на 20%
меньше. Рядом с курсором отображаются тип привязки, длина и угол стены или
размеры прямоугольника. Направляющие показывают горизонталь, вертикаль,
диагональ 45°, параллель и перпендикуляр к последнему отрезку либо стене у
начала текущего отрезка. Удерживайте Shift, чтобы ограничить направление
шагом 45°, и Alt, чтобы временно отключить автоматические привязки.
Space + drag перемещает камеру во время построения.

Начало или конец стены на оси создаёт общую вершину через split. Сторона
новой комнаты повторно использует стены и промежуточные вершины общего
контура. Разрез рядом с проёмом подсвечивается и отклоняется. Разрешённый
разрез сохраняет положение и ID проёма.
Пересечения прямых осей автоматически превращаются в общие T/X-вершины
с разбиением всех участвующих рёбер (BUILDER-05).

Chromium QA для BUILDER-01 запускается командой
`node scripts/qa/builder01.cjs` на существующей сцене 10 «Лесная таверна».
Скрипт проверяет масштаб 50/100%, два общих контура, проёмы и Player-проекцию,
сохраняет снимки в `artifacts/builder01/` и восстанавливает исходный граф.

### BUILDER-02 — выделение и перемещение

В Build → «Правка» клик по стене выбирает её, клик внутри комнаты выбирает
комнату. Shift + клик добавляет или снимает стену. Рамка с пустого места
выбирает стены, обе вершины которых попали внутрь. Shift + рамка добавляет
их к выделению и может начинаться внутри комнаты. Двойной клик по стене
выбирает её комнату, если она одна, либо всю связную группу стен.

Потяните выделение прямо на карте или задайте точное смещение в Inspector
через «Переместить». При перетаскивании предпросмотр показывает смещение,
узел сетки либо выравнивание по X/Y с ближайшей неподвижной вершиной.
Alt временно отключает привязку, Esc отменяет жест. В Inspector материал
и толщину можно применить ко всему выделению стен, включая периметр комнаты.
Для одной выбранной стены Shift+S делит ребро, Shift+R меняет его направление.

Все вершины выделения получают одно смещение. Соседние стены и контуры
полов используют те же общие вершины, поэтому перестраиваются вместе с ними.
Проёмы сохраняют ID, ширину и относительное положение на своих рёбрах.
Токены и объекты сохраняют свои координаты.
Совпадающие концы прямых стен соединяются общей вершиной, пересечения
разбиваются в T/X-стыки. Граф отклоняется целиком при наложении стен, вырождении
или выворачивании комнаты, выходе за bounds, нарушении зазоров проёмов или
если итоговый блокирующий участок перемещённой стены перекрывает токен.
Сервер проверяет итоговую геометрию под блокировкой SceneTransaction.
Каждый завершённый жест даёт одну ревизию и одну запись Undo/Redo.

Команда `node scripts/qa/builder02.cjs` проверяет перемещения на Scene 10 при
50% и 100%, фильтрованное обновление Player через Reverb и восстановление
исходного графа. Запись разведанной территории в тестовых запросах выключена.
Снимки и отчёт находятся в `artifacts/builder02/`.

### BUILDER-03 — круглые комнаты, овалы и дуговые стены

Build → **Круг**, **Овал**, **Дуга** используют ту же компактную панель,
материалы, сохранение и Undo/Redo. Круг строится от центра до точки радиуса,
овал — от центра до точки двух полуосей (drag или два клика). Для дуги задайте
центр, начало/радиус и конечный угол по часовой стрелке; Enter после радиуса
создаёт полукруг. Live preview показывает радиусы, размеры и углы. Работают
привязки к вершинам, осям стен и сетке; Alt отключает привязки, Shift при
построении дуги и правке углов даёт шаг 15°. Esc отменяет незавершённый жест.

Ребро графа может содержать `curve`: `group`, `kind` (`circle`/`ellipse`),
`cx/cy`, `rx/ry`, `rotation`, `start`, `sweep`. Углы в градусах по часовой
стрелке в world coordinates. Замкнутая комната состоит из четырёх четвертей
с общей параметрической формой. Промежуточные точки аппроксимации не сохраняются
и не становятся объектами Pixi или редактируемыми вершинами. Рекурсивная
канонизация хэша устраняет зависимость от порядка вложенных JSON-ключей MySQL.

В «Правке» клик по кривой выбирает всю её форму. Inspector и маркеры меняют
центр, радиусы и поворот; у отдельной неразрезанной дуги также начало и размах.
Перемещение, рамка, материалы и толщина используют BUILDER-02. Общие вершины
с прямыми стенами перестраиваются вместе с формой. Привязка прямой стены к
середине дуги создаёт параметрический split и сохраняет floor contour.
Произвольное растягивание одной вершины кривой отклоняется; используйте маркеры.
После split углы отдельных частей остаются в графе, общая форма редактируется
через центр, радиусы и поворот. Слияние прямой стены с дугой не поддерживается.

Frontend и PHP используют одну формулу: шаг не более 5° и chord error до
0,25 wu (+ округление координат до 0,001 wu). Полы, видимые полосы стен,
клиентское движение и серверные Collision/LOS/Lighting следуют этой геометрии;
круглые соединения закрывают стыки сегментов. Все стены остаются в существующих
трёх Graphics (полы, стены, публичная основа). Бюджет — 4096 отрезков на граф,
радиусы от max(8 wu, толщины), отдельная дуга 5..359°; полный круг — комната.
Старый граф без `curve` не требует миграции.

Двери и окна привязаны к `edgeId` и доле длины дуги; при reshape сохраняются ID,
ширина и относительный центр. Полотно/рама — хорда между краями проёма, одинаковая
в рендере и физике. Проём не может пересекать стык четвертей/частей дуги. Недостаток
зазоров, пересечения, выход за карту и перекрытие токена отклоняют весь граф.
Разрез и разворот кривой с проёмом пока безопасно отклоняются: сначала удалите
проём отдельным действием. Undo/Redo возвращает полную форму вместе с проёмами.

Обратимая Chromium QA: `node scripts/qa/builder03.cjs`, существующая Scene 10,
50/100%, отдельный Player-контекст. Скриншоты и отчёт: `artifacts/builder03/`.
При прерывании используйте `--restore` с оставшимся приватным снимком.
Проверено в Chromium 156: все перечисленные сценарии, фильтрованный Player
realtime, HTTP/Reverb-маски света, включая диагональ круглой башни. Число Graphics
до/после — 184/184; граф, свет и активная сцена восстановлены. Frontend: 362 теста;
backend-интеграция MapWorld/Structure/Movement/LOS/Lighting/Vision/Fog: 60 тестов.
Build и lint проходят. После изменения PHP долгоживущий queue worker должен быть
перезапущен обычным native launcher, иначе realtime-свет использует старый код.

### BUILDER-05 — захват, соединения и заливка пола

В «Правке» у выделенной стены, группы или комнаты есть маркеры переноса:
центр, углы и середины сторон габарита, вершины контура и середины стен.
Они переносят всё выделение без изменения формы; связанные внешние стены
сохраняют общие вершины. У кривых остаются прежние параметрические маркеры.
Shift во время переноса ограничивает вектор шагом 45°, Alt отключает
автоматические привязки; их можно удерживать вместе. Shift + клик сохраняет
добавление/снятие стен. Привязки используют неподвижные вершины, середины,
оси стен, направляющие X/Y и сетку. Preview показывает результат и причину
отклонения до сохранения. Inspector → «Переместить» поддерживает смещение
и абсолютные координаты выбранной точки захвата с точностью 0,001 wu.

Прямые стены автоматически получают общие вершины в T/X-пересечениях при
рисовании и переносе. Клиент строит preview, сервер повторяет нормализацию
в SceneTransaction перед проверкой геометрии. Каждый исходный ID стены
остаётся у первого фрагмента по её направлению; остальные фрагменты наследуют
материал, толщину и блокировки. Контуры комнат дополняются вершинами стыков,
проёмы сохраняют ID, ширину, положение на перенесённой оси и сторону открывания.
Наложение стен, разрез возле проёма, вырождение, выход за карту и перекрытие
токена отклоняют весь жест. Стены не удаляются при автоматическом соединении.
Один жест — одна ревизия и одна запись Undo/Redo, включая все split и привязки.

Build → **Пол**: выберите материал из визуальной библиотеки, наведите курсор
на замкнутую область и нажмите. Подсветка показывает именно грань wall graph,
включая контур из отдельных стен без заранее созданной комнаты. Повторная
заливка меняет материал той же комнаты; «Без пола» снимает её материал.
Незамкнутые стены и тупиковые ответвления не создают ложных областей.
Перегородки разделяют области заливки; исходная комната остаётся, меньшие
окрашенные области рисуются поверх неё независимо от сортировки ID.
Клик в «Правке» выбирает меньшую область под курсором.
Контуры с внутренним замкнутым островом явно отклоняются: формат комнаты
пока не хранит отверстия. Объединение пересекающихся комнат и новая поддержка
проёмов на кривых в эту доработку не входят.

Обратимая Chromium QA: `node scripts/qa/builder05.cjs`, существующая Scene 10,
50/100%, отдельный Player-контекст. Проверяются anchors, Shift/Alt, точные
координаты, привязки, T/X под разными углами, пол из библиотеки, недопустимые
операции, Undo/Redo, reload и фильтрованные Reverb patches. Исходные граф и
активная сцена восстанавливаются; при прерывании используйте `--restore`.
Отчёт и скриншоты: `artifacts/builder05/`.

### BUILDER-06 — пересечения помещений и проёмы на составных дугах

Прямоугольник, круг, овал и контур можно разместить с пересечением другого
помещения, в том числе переносом отдельной комнаты. После размещения
контекстная панель предлагает три варианта с предпросмотром итоговых стен:
**Объединить помещения** удаляет внутренние участки обеих границ;
**Оставить перегородку** сохраняет обе границы и общие вершины пересечений;
**Обрезать пересекающуюся часть** сохраняет существующую границу и только
внешнюю часть новой комнаты. Esc отменяет предложение без записи в историю.
Круг с центром на прямой стене при объединении создаёт полукруглую пристройку.
Соседние прямоугольники с общей стороной также объединяются без внутренней стены.

Полное вложение комнаты в другую комнату и установка прямой стены точно на
другую прямую стену сохраняются сразу, без диалога частичного пересечения.
Вложенная комната сохраняет свои стены и собственный пол; при отсутствии
собственного покрытия виден внешний пол. Совпадающий участок прямых стен
становится одной общей границей, включая контакт с отдельной стеной.
Проёмы сохраняют положение и ориентацию; конфликтующие проёмы отклоняются.
Перенос исходной комнаты через общую границу не переносит соседнее помещение
или отдельную опорную стену. Это работает также для центра круга/овала и
координат исходного помещения в Inspector.

Опциональный `assemblies` хранит исходные комнаты и порядок операций.
Сборка включает только затронутые связанные помещения; независимые комнаты
сохраняют свои ID. Сами пересечения делят параметрические оси, а не превращают
кривые в независимо редактируемые отрезки. Итоговые `vertices/edges/rooms`
остаются единственным wall graph для рендера, Collision, LOS и Lighting.
`floors` содержит производные области материалов: отдельное разбиение исходных
контуров сохраняет стыки покрытий без физических перегородок. В пересечении
при частичном пересечении приоритет имеет более ранний пол, включая «Без пола»; новый материал не проступает
в обрезанной части. Материалы удалённых внутренних стен сохраняются в
исходных формах для последующей правки. В Inspector можно менять соединение,
пол и размеры исходного прямого помещения; круг и овал используют прежние
параметрические поля и маркеры. При изменении формы пересечения и полы
пересчитываются. «Пол» в сборке меняет материал исходной формы под курсором,
включая снятие материала; остальные исходные полы сохраняются.

Дверь или окно могут пересекать искусственный стык четвертей: совместимые
дуги автоматически объединяются в той же транзакции; у замкнутой формы
искусственный стык переносится на свободный участок вне проёмов, чтобы
после обрезки сохранялся корректный контур. Реальные T/X-стыки,
неподходящая ширина, пересечения проёмов и исчезновение несущего участка
не разрешаются. Preview и физическая панель используют одну хорду краёв
проёма. Положение хранится на исходной параметрической оси, поэтому ID,
ширина и относительный центр сохраняются при смене радиуса и пересчёте
внешних фрагментов. Произвольный split/reverse кривой с проёмом через
обычные команды редактора по-прежнему ограничен; правьте исходную форму.

Сервер заново строит сборку из проверенных источников внутри SceneTransaction,
проверяет авторизацию, материалы, bounds, геометрию, сохранность проёмов и
занятые токенами участки. Рецепты доступны только GM; игрок получает итоговую
геометрию и публичные полы. Вычисляемые углы округляются до 6 знаков, доли
проёмов — до 8: hash стабилен после MySQL JSON roundtrip. История хранит
сборку, граф, материалы и проёмы целиком. Старые графы не требуют миграции.
Ограничения: до 32 исходных помещений в сборке, до 8 сборок, суммарно до
512 исходных стен и 4096 отрезков аппроксимации. Вложенные помещения разрешены;
каждое хранит отдельный замкнутый контур. Вырожденные фрагменты отклоняются явно.
Произвольная заливка области с отверстием без существующей исходной комнаты
по-прежнему требует дополнительной стены.

Chromium acceptance: `node scripts/qa/builder06.cjs` собирает пристройки к
существующей таверне Scene 10 и сохраняет успешный результат по запросу
пользователя; это не скрипт для бесконтрольного повторного запуска.
`node scripts/qa/builder06-followup.cjs` обратимо проверяет уже сохранённое
здание: размеры исходной прямой пристройки, окно через стык четвертей,
сохранение двери, Undo/Redo/reload, Player Reverb и HTTP/worker Lighting.
При прерывании соответствующий скрипт принимает `--restore` и использует
локальный игнорируемый приватный снимок. Отчёты и скриншоты:
`artifacts/builder06/`. Существующие токены, свет, активная сцена и временные
правки followup восстанавливаются; Fog exploration в QA отключён.
`node scripts/qa/builder06-placement.cjs` обратимо проверяет перенос внутрь
помещения с полом, общую стену двух комнат, контакт с отдельной стеной,
перенос обратно, Undo/Redo, LOS и reload GM/Player. Отчёт и снимки:
`artifacts/builder06-placement/`; прерванный прогон восстанавливается через `--restore`.

### Данные и синхронизация

MapWorld хранит ограниченный JSON-граф с общими вершинами, ориентированными
рёбрами и комнатами с упорядоченными циклами вершин. Рёбра имеют стабильный ID,
толщину, необязательную версию Wall и три флага блокировки. Комнаты ссылаются
на необязательную версию Floor. При split первый участок в направлении исходного
ребра сохраняет его ID. Остальные связанные рёбра не перенумеровываются.
FK-таблица защищает используемые immutable material versions. Удаление MapWorld
через Undo запрещено, пока есть стены. Уменьшение bounds проверяет полную
толщину стен. Дубликат сцены получает собственный граф с теми же локальными ID.

Один завершённый жест проходит через ScenePersistence, SaveQueue и SceneTransaction.
Сервер проверяет GM-доступ, хэш исходного графа, топологию, bounds и материалы,
затем увеличивает Scene revision. History использует шифрованные состояния до
и после правки. Обычные события передают только изменённые записи графа и
определения материалов. При превышении бюджета события, конфликте хэшей или
разрыве ревизий используется существующее восстановление из snapshot.
Player получает видимую геометрию, блокировку движения и данные для текстур. Флаги обзора/света,
библиотечные имена и история правок остаются у GM. Доступ к приватным текстурам
для Player действует только пока они используются на активной сцене.

### Рендер и контракт геометрии

Общий Pixi-рендер рисует полы над Terrain, затем сетку, стены, props и токены.
Материал повторяется с единым началом координат, масштабом и поворотом версии.
Пол использует простой многоугольник, стена — полосу с круглыми торцами.
Тёмный внешний край рисуется для всех стен перед лицевой поверхностью, чтобы
не оставлять внутренних обводок на стыках. Нейтральная стена доступна без
материала. Для повторов подходят непрозрачные, бесшовные текстуры.

В MAP-04 StructuralGeometry::compile возвращал schemaVersion 1 и капсулы с ID
исходного ребра, конечными вершинами, радиусом, версией материала и независимыми
blocksMovement, blocksVision, blocksLight. Их объединение подразумевается на
стыках. Контракт подходит для отдельных пространственных запросов по каждому
флагу и не меняет движение токенов. Сетевые ID имеют область действия MapWorld.

MAP-05 расширяет контракт капсул плоскими торцами у проёмов. Для MAP-07
потребуется проверить семантику толщины у смешанных стыков и построить
пространственный индекс с инвалидированием по хэшу.
Граф ограничен 512 вершинами, 512 рёбрами, 128 комнатами, 128 вершинами на
контур, 24 версиями материалов и 180 КБ JSON. Полы без отверстий. Стены
публичны как часть карты, с существующим визуальным слоем Fog.

Тесты: StructureTest, tabletop/structure/model.test.ts и
node scripts/qa/map04.cjs. Browser QA использует постоянный полигон и
сохраняет снимки и отчёт в artifacts/map04.

## MAP-05 — двери и окна

Build → «Дверь» / «Окно» показывает ширину и допустимость вставки на
стене. После установки инструмент остаётся активным для следующих проёмов;
Esc возвращает к «Правке». Перетаскивание по стене
меняет позицию, Inspector меняет ширину и свойства. Для двери доступны
петля, направление, угол, открытие и замок. Для окна доступны деревянная
и металлическая рамы и три независимых флага блокировки. По умолчанию
окно блокирует движение и пропускает обзор и свет.

Серийное размещение принимает до 16 ожидающих действий, включая запрос в полёте.
Каждый клик фиксирует тип, ширину и положение на несущей стене в мировых
координатах (center на зафиксированной геометрии ребра). SaveQueue отправляет
проёмы последовательно: граф и expected hash собираются непосредственно перед
отправкой из последней подтверждённой сцены. Изменение несущей геометрии и
перекрытие уже принятого проёма явно отклоняются; SceneTransaction повторно
проверяет весь актуальный граф под блокировкой. Новая команда не заменяет
предыдущую. Кольцо отмечает pending, красный крест — rejected; каноническая
створка/рама и отдельная запись Undo/Redo появляются только после receipt.
Счётчики Build показывают результаты последних размещений. Переполнение явно
сообщается. Смена инструмента сохраняет очередь, Esc отменяет только ещё не
отправленные действия. При неоднозначной сетевой ошибке Retry использует прежние
payload и mutation ID; Esc сохраняет такой отправленный запрос для разрешения
результата. Rejected не повторяется автоматически и не блокирует следующие
действия. Reload загружает только серверные результаты; локальные превью и
неотправленные действия не восстанавливаются.

Регрессия очереди: `OpeningPlacements.test.ts`, обратимый browser QA
`node scripts/qa/opening-queue.cjs` на Scene 7 (HTTP delay, 12 смешанных проёмов,
Undo/Redo каждого, инструменты, Esc, rejection, reload и Player realtime).

Проём хранится в необязательном списке openings существующего JSON-графа
MapWorld. Его ID локален для графа, center — доля длины ориентированного
ребра, width — мировые единицы. Перенос и изменение длины сохраняют долю,
ориентацию и ширину. Split и join пересчитывают долю, сохраняя физическую
позицию и ID. Reverse отражает долю, меняет метку петли и сторону поворота,
сохраняя положение створки. Join доступен для двух соосных стен с
одинаковыми свойствами и обновляет циклы комнат. Разрез рядом с проёмом,
перекрытие, слишком короткая стена и удаление несущей стены отклоняются.
Проём можно удалить отдельной правкой. Undo/Redo использует тот же
зашифрованный снимок структуры, что и стены и полы.

StructuralGeometry::compile возвращает schemaVersion 2. У каждого участка
есть id, edgeId, радиус и признаки roundA/roundB. На топологических вершинах
сохраняются круглые торцы, у проёмов торцы плоские. Закрытая дверь и окно
добавляют плоскую полосу с openingId и радиусом min(4, толщина стены / 2),
совпадающую с силуэтом рамы или закрытой створки. Замок не меняет
геометрию. Открытая дверь оставляет полный проход, её повёрнутая створка
рисуется Pixi как презентация. Угловой вынос створки и сложные стыки
учитываются отдельно при проектировании потребителя геометрии в MAP-07.
Движение токенов, LOS и освещение в MAP-05 не меняются.

GM открывает и закрывает двери и окна через контекстное меню проёма в
сессии и редакторе. Игроки могут делать то же самое в активной сцене.
Если включён обзор игроков, проём должен быть в текущем поле зрения.
Запертую дверь может отпереть GM. Закрытие двери отклоняется, если проход занят.
Окна по умолчанию открыты и всегда блокируют движение. Закрытая створка
затемняется и перекрывает обзор и свет.

Команда состояния проверяет хэш проекции отправителя и публикует изменения
через `structure.updated`. Игроки получают состояние проёма и изменения обзора
через инкрементальные патчи. Данные замка и история правок доступны GM.

Проверки: StructureTest, tabletop/structure/model.test.ts и
node scripts/qa/map05.cjs. Скриншоты и отчёт находятся в artifacts/map05.

## MAP-06 — Object Presets и коллайдеры

Object Presets доступна из Assets в GM Hub и из Map Editor → Objects.
Библиотека принадлежит аккаунту и работает во всех его кампаниях.
Пресет использует принадлежащее автору изображение типа prop из Assets.
Есть поиск по названию и категории, создание, правка, копирование и
удаление. Изображение защищено от удаления и замены, пока используется
пресетом или размещённым экземпляром пресета.

Логические размеры задают плоскость изображения в мировых единицах
при масштабе 1. Pivot задаётся долями ширины и высоты от левого верхнего
угла. Коллайдер редактируется поверх изображения. Маркеры управляют
углами прямоугольника, центром и радиусом круга или вершинами
многоугольника. Shift привязывает маркеры к шагу 5. Доступны зум,
сброс формы и три отдельных флага блокировки. Многоугольник содержит
3–32 вершины. Сервер отклоняет совпадающие вершины, пересечения,
наложения рёбер и вырожденные контуры.

«Разместить» включает Pixi ghost и повторный штамп. R и Shift+R меняют
угол на 15°, Esc завершает размещение. Shift-выбор и групповое
дублирование используют существующие команды SceneProp. Inspector
позволяет править трансформ и коллайдер экземпляра. Снимок пресета
хранится в nullable JSON SceneProp и копируется при дублировании.
Изменение или удаление пресета не меняет размещённые объекты.
SceneTransaction, SaveQueue и Undo/Redo обслуживают команды экземпляров.
Сохраняются ID, добыча и взаимодействия SceneProp. Для старых объектов
используются размеры исходного изображения и центральный pivot.

`StructuralGeometry::forScene` добавляет к существующим
`schemaVersion: 2` и `segments` общий список `shapes`. У каждой формы есть
ID, источник и три независимых флага. Стены и проёмы используют `band`
с параметрами торцов, прямоугольник и многоугольник — `polygon`, круг —
точный `ellipse`. Преобразование точек выполняется как
`position + rotate((local - pivot) × scale)`. Эллипс хранит мировые
центр, две полуоси и угол. ID объекта имеет вид `prop:<SceneProp.id>`.
Открытые двери и формы `none` не дают коллайдеров. В MAP-06 игрового
потребителя геометрии нет.

Локальный GM-переключатель «Коллайдеры» показывает в Pixi контуры стен,
закрытых створок, окон и props. Цвет отражает комбинацию флагов, у
выбранного объекта ярче контур. Player получает видимые экземпляры,
визуальные размеры и pivot. Сервер фильтрует метаданные пресета и
коллайдеры в snapshot и realtime. Изображения используют существующую
авторизацию Assets.

Проверки: MapEditorPropsTest, StructureTest и `node scripts/qa/map06.cjs`.
Скриншоты и отчёт браузерной проверки находятся в `artifacts/map06`.

## MAP-07A — движение токенов

Обычный Drag передаёт конечную точку в существующий token.move. Snap выбирает
конечную точку в координатах мира, free Drag передаёт её напрямую. Физическая
проверка одинакова для обоих режимов. Команда допускает до 16 промежуточных
waypoints в порядке обхода. Начальную точку сервер читает под блокировкой
SceneTransaction, округляет входные точки до точности хранения и принимает
весь путь либо отклоняет его целиком.

- Normal включает одиночный и групповой Drag. В бою TurnBudget использует
  сумму евклидовых длин, масштаб существующей линейки и текущие правила
  скорости, хода и prone. Групповое перемещение откатывается целиком при
  отказе для любого токена. Выбранные props движутся с той же дельтой, поэтому
  их коллайдеры проверяются в относительных координатах.
- GM edit включает координаты Inspector и edit-history. Создание токена,
  размещение из библиотеки, spawn шаблона и копирование сцены считаются
  размещением. GM может исправить координаты внутри или вне препятствия.
- GM teleport проверяет footprint в точке назначения. Этот режим доступен в
  token.move и используется для токенов в Cue object.move. GM override
  пропускает collision и боевую стоимость. В Session его можно явно выбрать
  через Alt в начале одиночного Drag. Оба режима проверяют полномочия GM.
- Footprint является диском с радиусом size × scale / 2. Sweep проверяет
  полосы стен с их торцами, полосы проёмов и преобразованные коллайдеры props.
  Касание блокирует ход. Открытая створка декоративна. Попытка закрыть дверь
  поверх токена отклоняется. Редактирование стены или prop может оставить
  токен внутри препятствия. Для выхода нужна правка GM, teleport или override.
  Координаты токенов при изменении геометрии автоматически не меняются.
- Pixi рисует предложенный путь, footprint, расстояние и доступную дистанцию
  в бою. GM видит подсветку collision по своей текущей проекции. Player видит
  нейтральный путь и доступные ему данные о ходе. Сервер возвращает общий
  отказ без идентификатора или координат блокирующего объекта. Для MapWorld
  другим участникам публикуется подтверждённое положение через обычные события
  сцены. Начиная с MAP-07B сцены с MapWorld и без него показывают
  остальным участникам только принятые перемещения.
- Повтор команды использует текущий mutation receipt. Regions и Triggers
  продолжают сравнивать начальное и конечное положения принятой команды.
  Контракт waypoint пригоден для следующих режимов движения. В MAP-07A
  токены не сталкиваются с другими токенами, а маршрут выбирается вручную.

Проверки используют общий fixture tests/Fixtures/movement.json, TokenMovementTest
и movement.test.ts. Браузерная проверка GM и двух Players выполняется через
node scripts/qa/map07a.cjs на постоянном полигоне. Микробенчмарк
php scripts/qa/movement-benchmark.php измеряет sweep по 800 препятствиям с
компиляцией и без неё. Сервер отсекает кандидатов по ограничивающим границам,
компилирует актуальную геометрию один раз на команду и переиспользует её внутри
группы. GM preview держит производную геометрию в памяти до изменения проекции.

## MAP-07B — визуальное движение токенов

Drag показывает локальный путь и контур цели. После успешной команды Laravel
сохраняет конечные координаты и добавляет в receipt и событие той же ревизии
`tokenMovements`. Каждый элемент содержит ID токена и проверенный путь от
исходной позиции через waypoints до сохранённой конечной точки. В player-канал
маршрут попадает только для токенов, видимых до и после команды. Snapshot
содержит конечные координаты. Teleport, override и размещение идут без маршрута.

Pixi использует один существующий ticker и интерполирует по пройденной длине
в мировых координатах. Исходные настройки MAP-07B (420 единиц/с, 140–900 мс)
заменены естественной длительностью и скоростью в MAP-07E.3 ниже. Клиенты
запускают путь при получении подтверждения, поэтому сетевые задержки могут
сместить старт. Камера и заданный поворот портрета сохраняются. В смешанной
группе props сразу занимают принятые позиции.

На токен приходится один визуальный переход. Начиная с MAP-07E.3 новый принятый
ход сохраняет непройденный принятый остаток предыдущего пути без скачка к его концу.
При несовпадении начала с предыдущим состоянием,
новом snapshot, смене сцены или боевого хода позиция синхронизируется с
актуальной проекцией. Удаление убирает переход вместе с токеном. Reduced motion
сразу показывает конечную точку. Позиционные жесты и выбор токена для действия
могут досрочно завершить переход. Положение в Pixi не участвует в расчётах
дистанции, collision, TurnBudget, Regions и Triggers.

Браузерный сценарий `node scripts/qa/map07a.cjs` проверяет и MAP-07B. Он
считывает мировую позицию из кадров Pixi у ГМ и двух игроков.

## MAP-07C — Double-click / Click-to-Move

В режиме выбора одиночный доступный токен получает команду по двойному клику
на свободном месте карты. Одиночный клик, выбор объектов, marquee, Drag,
targeting, линейка, инструменты редактора и UI сохраняют своё назначение.
Назначение привязывается к существующей сетке только при включённом snap;
промежуточный путь использует мировые координаты независимо от grid/free.
Маркер назначения и полилиния рисуются существующим InteractionLayer.

В exploration найденный путь сразу отправляется как normal token.move, но
токен начинает MAP-07B-анимацию только после принятия Laravel. В бою плавающая
панель показывает стоимость и остаток TurnBudget, затем требует кнопки
«Подтвердить движение». Расстояние — сумма евклидовых сегментов по существующему
масштабу линейки; prone и округление стоимости совпадают с TurnBudget.
Превышение бюджета, чужой ход и incapacitated не разрешают подтверждение.
Сервер проверяет правила заново. Escape/«Отмена» отменяют поиск или
неподтверждённый preview; уже отправленная команда не отзывается.

### Navigation / geometry contract

`navigation/pathfinding.ts` выполняет ограниченный weighted A* (вес эвристики
1.15) с восемью соседями, binary heap и евклидовой стоимостью. Начальный шаг
`max(2, min(24, grid.size / 2, tokenRadius))`, затем уточнение до половины
и до 1–2 мировых единиц, если предыдущая сетка исчерпана. Поиск ограничен
24 000 обработанными узлами и 250 мс на запрос. Worker прекращается через
2 секунды вместе со startup/доставкой. На mousemove поиск не запускается.

Три связанные опорные точки открытого проёма (подход, центр, выход)
соединяют навигационную сетку через узкие и наклонные двери независимо от
её фазы. Это только дополнительные кандидаты пути: каждый переход,
включая диагонали и связи проёма, проходит существующий MAP-07A sweep.
Толщина, торцы стен, состояния дверей, movement-флаги окон и преобразованные
коллайдеры props берутся из существующих movementObstacles/movementBlocked,
согласованных с StructuralGeometry и MovementCollision общими fixtures.
Footprint — прежний диск `size × scale / 2`. Запас 0.01 покрывает округление
координат до 0.001 и запрещённое касание. Токены друг с другом не сталкиваются.

Spatial bins по 128 мировых единиц ускоряют выбор кандидатов. Большие формы
проверяются отдельно; длинный запрос может использовать полный список.
Это broad phase существующего collision, не новая физическая система.
Индекс создаётся в Worker один раз на запрос; долгоживущего nav-кэша нет.
Новый snapshot, scene/geometry/door/prop/grid/combat update, смена выбора или
режима отменяют устаревший preview. Поздние ответы отменённых Workers
игнорируются. Следующая принятая команда использует обычные receipts,
SceneTransaction, revisions и замену визуального перехода из MAP-07B.
Если предыдущая команда ещё ожидает receipt, хранится только последняя новая
цель; поиск начинается от подтверждённой позиции после её принятия. При отказе,
snapshot/reconnect, смене геометрии или хода отложенная цель отменяется,
автоматического повторного поиска по неизвестному препятствию нет.

### Public projection and security

Player получает movement-флаги уже публичных walls/windows; vision/light
и door.locked остаются GM-only. Флаги входят в публичный hash и incremental
structure patches, поэтому их правка инвалидирует navigation так же, как
изменение двери. Graph сейчас не имеет отдельной visibility стены/secret door:
эти структуры уже публично рисуются; добавления скрытых structural entities
MAP-07C не делает. При будущем добавлении их следует фильтровать до построения
публичного graph и опорных точек проёмов.

Видимый prop получает только `movementObstacle`: мировой polygon с padding=0
или ellipse с center/rx/ry/rotation в радианах, либо null. Поля collider/preset,
названия пресета, tags, vision/light и скрытые props в Player-проекцию не входят.
Snapshot и realtime используют одну projection SceneProp. Это намеренное
расширение MAP-06/07A: публичный физический контур разрешён для navigation,
редакторские метаданные остаются закрытыми.

Полного StructuralGeometry у Player нет. Поиск выполняется только в его
проекции. Laravel проверяет путь против полного текущего мира. Неизвестное
препятствие даёт только «Перемещение недоступно.», без координат, ID, типа,
частично принятого пути или подсказки обхода. Автоматического повторного поиска
после отказа нет. Player collision phase проверяет все сегменты и дополняется
до 40 мс при успехе и отказе, чтобы сгладить обычные различия времени проверки.
Это padding, а не гарантия постоянного времени всей сети/БД при любой нагрузке.

### Simplification and limitations

Line-of-sight pulling сохраняет наиболее дальнюю достижимую точку; каждый
shortcut повторно проверяется тем же sweep после канонизации координат.
Отправляется максимум 16 промежуточных точек плюс origin/destination.
Если найденный путь не сокращается до лимита или расчёт исчерпал бюджет,
команда не отправляется; UI предлагает более близкую промежуточную цель.
Упрощение никогда не удаляет обязательный collision corner ради лимита.
Алгоритм не гарантирует кратчайший путь или нахождение каждого геометрически
возможного субпиксельного прохода. Navigation ограничена границами MapWorld;
для токена вне карты или внутри blocker нужны существующие действия GM.

В исходном MAP-07C Regions/Triggers сравнивали только endpoints. Это ограничение
устранено в MAP-07E.1 ниже: normal movement передаёт полный accepted path в
существующий TriggerEvents. Reactions/прерывания по-прежнему требуют отдельного
серверного контракта; queued Cue не останавливает уже принятую команду.
WASD exploration реализован отдельным input mode в MAP-07D ниже.

### Validation and benchmark

Focused regressions: ClickToMoveTest, TokenMovementTest, StructureTest,
MapEditorPropsTest; frontend navigation, movement, ObjectGesture,
ScenePersistence, TokenLayer/tokenPath и SceneSubscriber. Отдельный тест
проверяет узкую наклонную дверь, не совпадающую с сеткой.

`node scripts/qa/navigation-benchmark.mjs` использует именно production algorithm
на 800–801 препятствиях (12 запусков). Native Node, текущая машина:

| Сценарий                                  | Результат                       |    Median |       P95 |
| ----------------------------------------- | ------------------------------- | --------: | --------: |
| Обход здания, 801 obstacle                | 3 точки                         |   1.93 мс |   6.11 мс |
| Между рядами мебели, 800 obstacles        | 4 точки                         |   2.54 мс |   2.94 мс |
| Диагональный мебельный лабиринт           | безопасный waypoint-limit отказ | 193.47 мс | 223.71 мс |
| Недостижимая половина сцены, 801 obstacle | безопасный node-budget отказ    |  82.26 мс |  89.51 мс |

В браузере расчёт изолирован в Worker и не занимает main thread.
`node scripts/qa/navigation-browser-benchmark.cjs` проверяет production Worker
в Chrome: сложный запрос с 800 препятствиями занял 193.5 мс, main thread
обработал 19 heartbeat-сигналов с максимальным интервалом 11.1 мс.
`node scripts/qa/map07c.cjs` переиспользует permanent fixture и отдельные
contexts ГМ + двух Players: здание, двери, footprint, мебель, длинный путь,
скрытый blocker, Drag/ruler, быстрый повтор до HTTP receipt,
combat preview/confirmation/cancel, budget/turn и reload.
`node scripts/qa/map07a.cjs` сохраняет checks Drag, MAP-07B, reduced-motion,
Realtime/reconnect. Временные props/preset/geometry удаляются, позиции/grid
восстанавливаются; после Combat QA применяется штатная qa:townhouse.
Артефакты: `artifacts/map07c/benchmark.json`, `browser-report.json`, screenshots.

## MAP-07D — WASD exploration control

Статус: реализован вертикальный срез WASD. Общий MAP-07 остаётся открытым до
integration review. LOS/Fog/Lighting, NPC AI и новые Combat Rules не входят в эту работу.

### Input, prediction and presentation

Выберите один доступный `player_character` и нажмите «Управлять · WASD».
Физические клавиши W/A/S/D работают независимо от раскладки; диагональный вектор
нормализован. Скорость исследования — 180 мировых единиц/с, без grid snap.
Escape выключает режим. Переключение инструмента, pointer interaction, targeting,
ввод текста или modal возвращают управление обычному UI. Checkbox камеры остаётся
доступным: follow использует существующий Camera/Pixi ticker с экспоненциальным
сглаживанием 180 мс. В active Combat режим недоступен клиенту и серверу.

`WasdControl` подключён к существующему Pixi ticker, отдельного RAF/game loop нет.
Canonical SceneStore не меняется на prediction frames. Публичный MAP-07A sweep
проверяет каждый визуальный отрезок с тем же footprint и запасом округления 0.01.
Скрытые препятствия в prediction не участвуют. Направления сохраняются как короткий
путь с сохранением поворотов: максимум 18 точек, максимум 71.8 единицы неподтверждённого
пути, включая отправленную часть. Collinear samples схлопываются; неизвестные
collision corners не удаляются. Отпускание клавиш немедленно прекращает добавление
визуального движения; уже введённый короткий путь подтверждается сервером.

Receipt сохраняет непрерывность локальной presentation и обновляет только
подтверждённую позицию. При отказе prediction удаляется, режим выключается,
показывается нейтральное сообщение и запрашивается snapshot. Автоматического
повторения/поиска обхода нет. Скорость prediction плавно адаптируется к измеренному
времени receipt: при backpressure управление замедляется, не накапливая очередь.

Для остальных клиентов `tokenMovements.continuous` добавляет принятый путь к
непроигранному остатку MAP-07B. Интерполяция линейная, без нового easing на каждом
шаге; повороты сохраняются. Playback ограничен 600 мс / 64 точками: background
вкладка сбрасывает слишком старый хвост к свежему accepted path. Обычные Drag,
Click-to-Move и group paths сохраняют прежний MAP-07B easing; teleport/override
по-прежнему немедленны. Reduced motion сохраняет прежнюю политику remote playback.

### HTTP / authoritative stream contract

Новый transport не вводился. Используются HTTP mutations, существующие receipts,
SceneTransaction и Reverb events. Есть два endpoint:

- `POST /api/tokens/{token}/control/start`: выдаёт новый stream ID и authoritative origin;
- `POST /api/tokens/{token}/control/step`: stream, следующий sequence, origin, endpoint,
  до 16 waypoints и `clientMutationId`.

Stream хранится в приватной nullable JSON-колонке `tokens.direct_control` обычной
миграцией. Эти данные не входят в token projection, snapshot или broadcast.
Start не меняет координаты/revision и не создаёт Scene event. Повторный start
receipt не может воскресить заменённый stream. Каждый step проходит прежний
`TokenActions -> TokenMovement::resolve -> MovementCollision` под тем же writer
lock; Regions/Triggers получают только принятое перемещение.

Сервер заново проверяет membership, ownership, активную Scene, kind/lock,
Exploration, актуальную геометрию, footprint и границы MapWorld. Нельзя передать
teleport/override через этот endpoint. Контракт ограничивает полный путь, а не
только дельту endpoint:

- максимум 36 единиц на команду, с малым допуском округления;
- server-time credit 180 единиц/с, ёмкость 72 единицы для jitter; смена stream не
  создаёт новый credit;
- минимум 100 мс между принятыми шагами, общий route limit 7 запросов/с на User
  для start + step;
- точный следующий sequence, совпадение origin с сохранённой позицией и TTL 1200 мс;
- старые/повторные команды используют существующий receipt либо получают conflict;
- нормальное перемещение/GM position или footprint edit отзывает stream через Token
  model hook; удаление, смена owner/Scene и Combat проверяются повторно на сервере.

Клиент отправляет не чаще одного step за 200 мс (целевые 5 Гц), держит только
один HTTP request в полёте, без SaveQueue/retry движения. Timeout 900 мс. Остаток
input path ограничен; старые generation callbacks не возобновляют управление.
Incremental Reverb events во время своего HTTP request ограниченно буферизуются
(64 события), затем упорядочиваются вокруг receipt. Periodic revision probe не
принимает задержанный собственный receipt за повод сбросить held-key режим.
Disconnect transport останавливает управление непосредственно по событию,
независимо от React batching/Pixi кадров. Reconnect/snapshot требует явного нового
включения WASD. Blur, visibility loss, смена selection/Scene/геометрии, token deletion,
GM correction, targeting и начало Combat также завершают режим.

Player получает прежнюю публичную movement projection. Неизвестная collision
возвращает только «Перемещение недоступно.», без blocker ID, координат и типа;
сохраняется одинаковый 40 мс collision padding для Player success/failure.

### Validation, measurements and limits

Воспроизведение: `node scripts/qa/map07d.cjs`. Используются только постоянные
GM/Player 1/Player 2, кампания/Scene 5 и существующий prepared combat, с отдельными
Chrome contexts. Временные props/preset/geometry удаляются, исходные позиции,
размеры, grid/map и подготовленный Combat восстанавливаются в finally.
Артефакты: `artifacts/map07d/browser-report.json`, `player-follow.png`.

Фактический native Windows прогон 2026-11-04 (PHP 8.3/MySQL, built assets, Chrome,
GM + 2 Players; p50 / p95, миллисекунды). До WASD 6 обычных moving commands
дали HTTP 237 / 266 мс и доставку GM 239 / 268 мс.

| Добавленный RTT |   n | Step HTTP p50/p95 | Receipt с задержкой p50/p95 | Фактическая частота | Reverb GM/P2 p50/p95 |
| --------------- | --: | ----------------: | --------------------------: | ------------------: | -------------------: |
| +0 мс           |  11 |         150 / 159 |                   151 / 159 |             4.96 Гц |            147 / 157 |
| +100 мс         |   9 |         138 / 162 |                   242 / 267 |             3.93 Гц |            138 / 162 |
| +250 мс         |   5 |         165 / 379 |                   417 / 634 |             2.12 Гц |            164 / 378 |

Два параллельных потока: 20/20 успешных шагов, суммарно **5.57 запроса/с**;
HTTP p50/p95 **275 / 570 мс**. Максимум запросов в полёте на контроллер — 1.
Средний response body одного шага — около 8.5 KiB (существующий Token DTO).
Laravel lifetime под двумя потоками, p50/p95: 144 / 165 мс.
SQL под двумя потоками, p50/p95: 30 / 40 мс.
Reverb dispatch под двумя потоками, p50/p95: 4 / 6 мс.

После 30 mode toggles и GC: DOM listeners 292 → 293 (+1 всего, не на каждое переключение),
Pixi tree 176 объектов без изменения. Дополнительная UI-only проверка (5 warmup toggles, затем две серии по 30) дала 292 → 293 → 293 listeners и 553 → 560 → 560 DOM nodes; последняя серия не увеличила счётчики (`artifacts/map07d/retention.json`). Smooth wheel zoom при follow также проверен: 0.716 → 0.986, с точным достижением прежнего zoom target. Проверка короткая; долгий production soak не проводился.

Focused validation: 46 backend tests / 622 assertions (SQLite `:memory:`), 68 frontend tests, production build и focused ESLint прошли. Browser regressions `map07a.cjs`, `map07c.cjs`, `map07d.cjs` также прошли.

Browser acceptance: WASD/diagonal/keyup, GM + 2 smooth remote views, camera follow,
walls/closed/open doors, visible/hidden blocking props, text input, Escape/blur,
reconnect snapshot, concurrent GM correction, two concurrent Player streams и Combat denial.
Fixture restored; JavaScript page errors: 0.

Latency injection добавляет по половине указанной задержки до и после настоящего
browser fetch; это дополнительный simulated transport RTT, не обещание полного
HTTP времени 100/250 мс. Remote event timing считается от фактической отправки
HTTP, поэтому не включает artificial client delays. Это короткие локальные
измерения, не production stress или p95 SLA.

Для 4–6 участников (GM + 3–5 движущихся игроков) целевые 5 Гц означают 15–25
movement mutations/с. Native Windows имеет один последовательный HTTP-worker;
измеренный throughput двух потоков ниже этого требования. При таком масштабе
backpressure снижает скорость, возможен безопасный timeout. Несколько PHP workers
могут уменьшить HTTP очередь, но общий campaign/Scene writer lock, 40 мс Player
padding, сборка DTO и membership fanout тоже требуют отдельного измерения.
Смена HTTP на WebSocket сама по себе эти затраты не устраняет. Cue worker и его
MySQL/tabletop очередь не менялись: movement не ставится в Cue jobs.

Известные ограничения:

- При большой задержке скорость ниже 180 единиц/с. Цель — ограниченный desync и
  предсказуемое замедление; постоянная скорость на перегруженном single worker
  не гарантируется. После 900 мс без receipt — остановка и resync.
- Уже отправленная команда может быть принята после локального Escape/blur;
  максимум один короткий шаг. Отмена не откатывает принятый Laravel state.
  Движение не пересылается автоматически после reconnect; новый stream отзывает старый.
- Неизвестное препятствие может потребовать заметной visual correction. Клиент
  не получает секретную физику ради более точного prediction.
- Публичные стены сейчас не имеют отдельной secret-wall visibility; сохраняется
  security contract MAP-07C. Будущие скрытые structural entities нужно фильтровать
  до публичной geometry projection.
- Ограничение endpoint-only Regions/Triggers исходного MAP-07D устранено
  интеграцией MAP-07E.1 ниже. Асинхронный Cue не является interrupt текущего шага.
- Mouse camera pan/shortcuts выходят из прямого управления. Mobile/gamepad,
  wall sliding и character walk sprites не добавлялись.

## MAP-07E.1 — Movement / Regions / Triggers integration (2026-11-04)

`TokenActions` и `SelectionActions` передают в существующий `TriggerEvents`
канонический путь из `TokenMovement::resolve`, только после успешной проверки
permissions, Combat budget и swept collision. Drag, Click-to-Move и bounded WASD
используют один контракт. Preview, receipt replay, snapshot/reconnect, realtime
delivery и Edit History не исполняют detection. Teleport, GM edit и override
сохраняют прежнее сравнение endpoints: воображаемого пути между ними нет.

### Geometry and event order

`RegionGeometry::crossings` вычисляет замкнутые интервалы пересечения движущегося
token disc (size × scale / 2) с rectangle/circle. Прямоугольник расширяется точно:
полосы плюс круглые углы, без ложных попаданий square padding. Сегменты идут по
порядку маршрута; интервалы объединяются на общих waypoints, включая нулевые
сегменты. Численный допуск объединения — 1e-7 world units.

- Boundary contact считается inside, как в прежнем `contains`.
- Начало внутри не создаёт enter; конец внутри не создаёт exit.
- Изолированное касание даёт enter → exit на одной дистанции.
- Движение вдоль границы даёт один непрерывный контакт.
- Разворот на граничном waypoint не дублирует контакт; реальный выход и новый
  вход на следующем участке создают новые crossings, даже при origin = destination.
- Порядок: пройденная дистанция; при равенстве enter перед exit, затем Region ID,
  Trigger ID, Token ID. Group drag имеет общий translation/length и тот же порядок.
  `CueRunner.queue_order` фиксирует этот порядок постановки и выполнения Cue.

### Idempotency, rules and private data

Каждый crossing имеет source key из command ID, token ID, crossing index и type;
уникальность `(trigger_id, source_key)` остаётся в БД. При `once=false`,
`cooldown=0` повторные пересечения могут запускать один trigger несколько раз в
одной root movement-команде. Once, cooldown (по серверному времени принятия,
не по кадрам анимации), actor filters, permissions автора и MAX_DEPTH сохранены.
Для Cue cascades дополнительно остаётся максимум одного fire на trigger/correlation
и trigger chain guard. Индекс trigger/correlation теперь неуникальный; история
не удаляется. Rollback миграции отказывается восстанавливать уникальность, если
уже существуют повторные crossings; прежний application code совместим с новым
индексом и продолжает проверять correlation на уровне сервиса.

Receipt, token position, budget, trigger_fires и queued Cue snapshots коммитятся
атомарно под существующими campaign/Scene locks. Переполнение лимита 100 pending
Cue отклоняет всю команду, без движения, расходов и частичных fire. Automatic
queue rejection имеет нейтральную ошибку без сведений об очереди/ловушке.
Player DTO/realtime и preview не получают Regions, crossing positions/IDs,
trigger metadata или Cue configs. Нового frontend/network contract нет.

### Interrupt boundary — explicitly unsupported

Поддерживается **уведомление о пересечении + существующий queued Cue**.
Cue исполняется асинхронно после commit и может впоследствии изменить игровой
state обычной authoritative mutation: это отдельное действие, не остановка
исходного пути. Stop-on-enter, trap interrupt, reaction pause, частичный ход и
отмена остатка маршрута этим контрактом **не поддерживаются**. Не следует
использовать queued `object.move`, incapacitation или `combat.begin` как обещание
остановки на границе Region. Нет client-only остановки или возврата бюджета после
принятия полного маршрута. Принятый endpoint, полный расход и MAP-07B animation
остаются согласованы. При rejection откатывается вся команда и расход равен нулю.

Будущий interrupt обязан обрезать path **до** persistence/spend/enqueue и вернуть
одни и те же endpoint/distance/path всем клиентам. MAP-07E.2/E.3, reaction engine,
LOS, pathfinding, collision rules и networking в этом проходе не расширяются.

### Validation

Focused backend: MovementTriggerTest, TriggerTest, TokenMovementTest,
ClickToMoveTest, DirectControlTest, CueTest, CombatTest — 46 tests / 616 assertions,
SQLite `:memory:`. Frontend: navigation, movement, TokenLayer/tokenPath,
ScenePersistence и SceneSubscriber — 64 tests; production build прошёл.
Browser reproduction: `node scripts/qa/map07e1.cjs`; постоянные GM + два Players,
Scene 5, временные narrow rectangle/circle Regions, existing Cue/Trigger actions,
wall/open/closed doorway. Проверяются настоящий Drag/Click-to-Move/WASD,
waypoint round trip, порядок, retry, multiplayer animation, reload и секретность.
Временные сущности удаляются, grid/map/structure/token и прежняя active Scene
восстанавливаются в finally; Scene 7 не редактируется. Обычные receipts/revisions
и история выполнения Cue остаются аудитом выполненных команд.
Артефакты: `artifacts/map07e1/browser-report.json`, `gm.png`, `player.png`.
Native browser run прошёл все 9 checks, JavaScript errors: 0; живой MySQL Cue
worker завершил принятые события. Fixture и исходная active Scene восстановлены.

## MAP-07E.3 — финальная интеграция и game feel (2026-11-04)

Статус: интеграция реализована и проверена; ожидается решение о закрытии MAP-07. Сам MAP-07 и MODULE 05
не закрываются автоматически; MAP-08 не начинается. MAP-07E.2 не реализован.
Серверные Movement Contract, collision, HTTP/Reverb, SceneTransaction, TriggerEvents
и TurnBudget не переписаны. Изменения относятся к input/presentation и lifecycle.

### Скорость, повороты и authoritative state

`tokenPath.ts` задаёт общую визуальную скорость **180 world units/s** для обычного
Drag и Click-to-Move; та же константа используется WASD. Верхнего лимита длительности
обычного пути больше нет. Прямой маршрут 780 единиц занимает 4413 мс, 1800 единиц —
10080 мс. Короткий путь 10 единиц — около 107 мс. Короткие ускорение/торможение до
80 мс не растягиваются пропорционально длинному маршруту. На повороте скорость
локально уменьшается по углу: около 127 ед/с на 90°, минимум 63 ед/с на развороте.
Вся интерполяция остаётся строго на принятой полилинии: геометрическое скругление
углов могло бы срезать collision clearance. Портреты не разворачиваются по направлению.

Laravel по-прежнему принимает полный endpoint/path, расход и события атомарно до
проигрывания анимации. Визуальная позиция не участвует в дистанциях действий,
TurnBudget, collision или Regions. Запуск targeting завершает presentation на
canonical endpoint; следующий action использует SceneStore, а не Pixi-координаты.

Новая принятая normal-команда во время анимации сохраняет непройденные углы
предыдущего принятого пути и продолжает новым принятым путём без скачка к origin.
Это не отмена уже committed gameplay movement. Esc отменяет поиск/preview, но
не возвращает потраченный бюджет и не отзывает принятый маршрут. Presentation
держит максимум 256 точек после многократных re-command; при переполнении
синхронизируется с origin последнего принятого пути. Серверный waypoint limit
остаётся прежним: 16 промежуточных точек. Continuous WASD playback сохраняет
прежний отдельный предел 600 мс и 64 точки для отставшего spectator.

### WASD и визуальная обратная связь

Старт непосредственный, keyup прекращает prediction без инерции. Смена направления
сглаживается с постоянной 45 мс, вектор нормализуется; противоположная команда
разворачивает движение сразу. Уже введённый короткий путь дренируется сервером,
не двигая визуальную позицию после отпускания клавиш. Receipt не перезапускает
локальную анимацию. Существующие one-flight/backpressure/timeout ограничения сохранены.

У видимой стены diagonal input пробует свободную ось и безопасную частичную длину
(8 делений). Каждый кандидат проходит прежний swept footprint с запасом 0.01,
исходная длина/скорость не увеличиваются, каждый принятый сегмент проверяется
Laravel повторно. Это input assistance, не новая collision/physics система.
Скрытые obstacles не участвуют в prediction и не раскрываются отказом.
Существующая optional camera follow с 180 мс smoothing сохранена.

Drag grid/free и Click-to-Move используют общий footprint outline и маркер цели:
ретикул радиусом 6 экранных пикселей читается на 29/50/100%. Во время поиска остаётся
цель, при недоступности она красная с крестом. Выбранный движущийся токен сохраняет
тонкую линию оставшегося принятого пути и контур canonical destination до остановки.
Не добавлены новые панели или дополнительные RAF/listeners.

### Lifecycle и найденные проблемы

- Long route/re-command раньше мог перескакивать к следующему server origin;
  теперь сохраняется безопасный принятый остаток без collision shortcuts.
- Grid/размер карты теперь также инвалидируют старую анимацию. Door/structure,
  blocking prop, snapshot, Scene/Combat/turn, deletion и GM coordinate intervention
  сохраняют authoritative reset. Принятые group paths продолжают анимироваться,
  включая mutation, которая одновременно передвигает props.
- В живом E.1 найден конфликт: terminal `clear` wait/trigger-only Cue освобождал
  камеру, которой не управлял, и Renderer отменял жест между двумя кликами.
  `DirectorState.reset` теперь освобождает камеру только после действительного
  camera control. Регрессия покрыта frontend-тестом и реальным E.1 browser run.
- Старые QA scripts после `qa:townhouse` теряли вручную изменённую позицию второго
  героя. Восстановление фактического исходного layout перенесено после recipe reset.
  Wrapper сохраняет позиции и исходную активную Scene; ручная Scene 7 не редактируется.
- Free-mode double-click округляется браузером до экранного пикселя; QA сравнивает
  presentation с accepted endpoint, а не с идеализированной исходной координатой мыши.
- На малом zoom подписи токенов и нижний Player HUD заметны относительно карты;
  часть нижней карты требует pan. Это существующий layout, его переработка Deferred.
  Плавающий route feedback также может перекрыть цель в своей области экрана.

### Проверки и артефакты

Frontend: 309 tests / 60 files; backend focused MovementTriggerTest, TriggerTest,
TokenMovementTest, ClickToMoveTest, DirectControlTest, CueTest, CombatTest —
46 tests / 616 assertions, SQLite `:memory:`. ESLint и production build проходят.
Build сохраняет прежние warnings о divider.png и размере dice-box chunk.

Native Chrome, существующие GM + 2 Players, отдельные contexts, Townhouse Scene 5.
`node scripts/qa/map07e3.cjs` последовательно переиспользует MAP-07A/C/D/E.1 checks
с восстановлением активной Scene. `node scripts/qa/map07e3-visual.cjs` выполняет
дополнительный визуальный прогон: три zoom, cottage/wall/door/furniture, длинные
маршруты и replacement, WASD wall slide/follow, geometry/teleport/reconnect,
targeting, group Drag, Scene switch, Combat start/turn switch и TurnBudget.
Видеозаписи требуется доступный Playwright FFmpeg; на этом стенде использован
уже установленный FFmpeg из игнорируемой artifacts-папки.
`YTT_QA_VIDEO=0` отключает video, сохраняя screenshots и timestamped frames;
`--lifecycle` продолжает только проверки прерывания/Combat по уже сохранённому
визуальному отчёту. Финальный отчёт объединяет zoom/exploration и lifecycle этапы.

E.1 browser run: все 9 checks, без повторных TriggerEvents на retry/reload,
MySQL Cue worker завершает события, Player не получает Region/Cue secrets.
WASD проверен также при дополнительных 0/100/250 мс RTT и двух одновременно
движущихся Players. После 30 toggles: Pixi children 177 → 177,
DOM listeners 292 → 293 (допуск теста +5), без растущего per-toggle retention.

Визуальный прогон: 17 успешных checks, JavaScript errors 0. Позиции, grid,
map/structure, временные props/presets и исходная active Scene восстановлены.
Screenshots, timestamped Pixi frames, GIF и WebM video:
`artifacts/map07e3/`; объединённый результат — `acceptance-report.json`.
Отдельные regression reports — `artifacts/map07e3/map07a.log`,
`artifacts/map07c/`, `artifacts/map07d/`, `artifacts/map07e1/`.

### Ограничения / Deferred

- E.2 stop-on-enter/reactions/частичный commit отсутствуют: Cue после crossing
  не обещает остановку на границе Region. Анимация не повторяет detection.
- Новый action, teleport, Combat/geometry/snapshot boundary может сразу показать
  canonical endpoint; это намеренная синхронизация уже принятого gameplay state.
- Разные сетевые задержки смещают старт у наблюдателей; общего синхронизированного
  animation clock нет. WASD при backpressure снижает скорость вместо накопления input.
- Sliding помогает вдоль мировых осей; произвольные tangential slides по наклонным
  коллайдерам, facing animation, camera follow для Click-to-Move, mobile/gamepad,
  HUD redesign и новый pathfinding не добавлены.
- Удаление существующего героя не выполняется destructive browser-тестом:
  deletion lifecycle проверяется изолированным TokenLayer test.
- LOS/Fog/Lighting, NPC AI и MAP-08 не начаты в этом проходе MAP-07.

## MAP-08A — серверный Line of Sight

`LineOfSight` — неизменяемый контекст пакетных запросов по существующему
`StructuralGeometry::forScene`. Нового авторского формата геометрии нет.
Движение и LOS используют общий `ShapeIntersection`, который не знает о
blocking flags. Каждый потребитель отдельно выбирает свой флаг; LOS читает
только `blocksVision`, включая скрытые GM props. `blocksMovement` и
`blocksLight` не влияют на обзор. Legacy Scene без MapWorld имеет пустую
структуру, но существующие preset colliders по-прежнему учитываются.

### Алгоритм и границы

Отрезок в мировых координатах Scene пересекается с полной толщиной wall bands,
круглыми топологическими торцами, плоскими торцами проёмов, transformed
polygons и точными повёрнутыми эллипсами. Открытая дверь удаляет панель из
compiled geometry; закрытая дверь и окно используют собственный `blocksVision`
(для двери без явного флага — true). Повернутая открытая створка остаётся
визуальной, как в существующем geometry contract.

Касание препятствия, движение луча вдоль его поверхности, попадание конечной
точки на поверхность и observer внутри препятствия блокируют LOS. Зазор больше
`1e-7` мировой единицы пропускает луч; это численный допуск, не игровой размер.
Нулевой луч виден, если точка вне препятствий. Дальность — евклидово расстояние
в мировых единицах; граница включительна, null означает отсутствие ограничения.
За пределами дальности запрос не возвращает сведения о препятствии.

### Sampling токенов

Политика `center-to-inset-disc-9-v1`: observer — центр токена; цель — центр и
восемь равномерных точек на 80% радиуса круглого footprint
`size × scale / 2`. Rotation не меняет круглый footprint. Достаточно одного
видимого sample. Результат `none / partial / full` означает 0 / 1–8 / 9
видимых samples. Range проверяется отдельно для каждого sample, поэтому край
цели может быть видим при центре вне дальности. Это направленный запрос:
обмен observer и target может изменить результат. Observer footprint не
расширяет точку зрения и не позволяет «подглядывать» из-за стены.

Это дискретная оценка частичной видимости, не процент открытой площади и не
Cover. Между samples может оставаться видимая полоска; `full` не доказывает
видимость каждой точки footprint. Перед MAP-08B эту политику следует учитывать
при проектировании Player Vision, а не превращать samples в security boundary.

### Контракт запросов и permissions

Сервис предоставляет `point(observer, target, range?, diagnostics=false)` и
`token(observerToken, targetToken, range?, diagnostics=false)`. Обычный point
result: `visible`, `reason: clear|blocked|out_of_range`, `distance`. Token result:
`visible`, `visibility`, `visibleSamples`, `sampleCount`, `policy`.
Диагностика добавляет ближайший `blocker {id, source, point}` либо sample rays.
Первый контакт находится монотонной бисекцией по префиксу луча (32 шага).

`POST /api/scenes/{scene}/los` — **только GM**, через ScenePolicy `update`, с
CSRF и throttle 120/min. Observer и 1–64 targets имеют вид `{point:{x,y}}`
или `{tokenId}`; одновременно оба поля запрещены. Token IDs разрешаются
только внутри запрошенной Scene. Входные точки ограничены миром Scene, range
0–40000 либо null. Ответ schemaVersion 1 содержит `sceneId`, `revision`,
`geometryKey`, `policy`, `observer`, `range`, упорядоченные `results`.
HTTP-адаптер возвращает диагностику GM; обычные сервисные запросы — без неё.
Авторизация выполняется до валидации содержимого. Campaign/Scene shared locks
в порядке существующих writers дают один согласованный снимок на пакет.

Player не имеет HTTP-доступа даже к boolean oracle LOS. Новых geometry/debug
полей в Player snapshot или событиях нет; существующая фильтрация hidden props,
colliders и vision/light flags сохранена. MAP-08A не фильтрует токены, не меняет
targeting, Combat Rules, ручной Fog и освещение. Будущему player adapter нужны
собственные разрешения и безопасная проекция; GM diagnostic DTO ему не подходит.

### Индекс, жизненный цикл и debug

Контекст компилируется один раз на пакет и переиспользуется всеми лучами.
Broad phase — sparse grid с ячейкой 256 мировых единиц по AABB blockers.
Форма, занимающая больше 256 ячеек, хранится в общем списке; очень длинный
луч с AABB больше 4096 ячеек использует линейный fallback. Эти ограничения
сдерживают память и обход пустых ячеек; точный kernel определяет результат.
`geometryKey` — SHA-256 compiled vision blockers с их transforms и flags.
Между HTTP-запросами кэш не хранится: каждый пакет читает актуальную геометрию,
так что wall/door/prop изменения не оставляют stale cache. Будущий длительный
кэш должен учитывать Scene identity и geometryKey, а результаты — также
позиции/footprints токенов, range и sampling policy.

Map Editor → **LOS** включает локальную компактную панель и Pixi overlay.
При включении выбирается «Выбор», боковая панель Objects скрывается;
несохранённые настройки защищены существующим guard редактора.
GM выбирает observer token, range, target token или точку кликом в режиме
«Выбор». 32 обзорных луча — диагностические замеры, **не visibility polygon**.
Мятный показывает clear, красный — блокировку с точкой первого контакта,
янтарный — превышение дальности. Стены и двери можно править в Build при
включённом debug. Запросы debounced на 180 мс после domain revision / параметров,
старые запросы отменяются; ответ другой revision не применяется и вызывает
синхронизацию. Pan/zoom/render frames LOS не пересчитывают. Ошибка скрывает
overlay; доступен повтор запроса. Debug не сохраняется, не транслируется и
после закрытия/перезагрузки выключен.

### Проверки MAP-08A

- Backend: `LineOfSightTest`, `TokenMovementTest`, `DirectControlTest`,
  `StructureTest`, `MapEditorPropsTest` — 31 tests / 639 assertions, включая
  узкий диагональный проём, касание повёрнутого эллипса и вогнутый prop collider.
- Frontend: vision model, SceneStore, mapEditor, structure, renderer и movement —
  39 tests; build/lint проходят.
- `php scripts/qa/los-benchmark.php`: 500 препятствий, 3000 лучей; compile +
  index 3.19 мс; indexed 45.54 мс (p95 0.0436 мс/луч), linear 334.63 мс,
  diagnostic 486.55 мс (p95 0.4829 мс/луч), peak 10 MiB. Геометрические
  результаты трёх режимов совпадают. Это локальный pure-geometry benchmark,
  без HTTP/DB/Pixi и не гарантия production latency.
- `node scripts/qa/map08a.cjs`: коридор/дверь, окна с разными flags, мебель,
  диагональная стена, общий угол и соединённые помещения; token/point debug,
  range, realtime invalidation и reload; Player denial/projection. Ошибок JS
  нет. Временные правки Scene 5 восстановлены с точной сверкой; Scene 7 не
  меняется этим временным QA-скриптом. Скриншоты и отчёт — `artifacts/map08a`.
- По прямому запросу постоянная Scene 7 дополнена отдельным LOS-крылом справа
  (`x=2100..3200`), без замены исходных movement zones, props и позиций героев.
  `node scripts/qa/los-playground.cjs` только читает состояние; `--apply`
  добавляет недостающие элементы, сверяет сохранность существующих и проверяет
  point/token LOS через браузер. Повторное применение не сбрасывает ручные
  изменения готового крыла. Инструкция — `docs/TEST_PLAYGROUND.md`.

На момент MAP-08A Player visibility filtering и targeting restrictions ещё не
реализованы; их контракт описан в MAP-08B ниже. Fog v2, explored areas,
Lighting, Darkvision, Cover и MAP-07E.2 остаются вне этого прохода.

## Уточнение после MAP-07E.3 — быстрый Click-to-Move, instant Drag и Esc

Эта секция заменяет поведение длительности/отмены из предыдущего отчёта E.3.
По уточнению пользователя Click-to-Move ускорен до 360 world units/s; WASD остаётся
180 ед/с. Обычный и групповой Drag больше не проигрывают walk animation: сервер
передаёт presentation flag `instant` в receipt и отфильтрованное realtime-событие.
Collision, normal movement permissions, стоимость и TriggerEvents остаются обязательными;
`instant` не является teleport/override. Сетевая задержка принятия команды сохраняется.

Click-to-Move исполняет найденную полилинию последовательными обычными командами
не более 72 world units, с интервалом не менее 200 мс и одним ожидаемым receipt.
Существующий Movement Contract проверяет и принимает каждый участок отдельно.
`routeStep` задаёт только linear presentation duration по длине принятого участка;
не меняет физику или полномочия. Углы сохраняются, сокращения через препятствия нет.
При медленной сети следующая команда ждёт receipt, вместо накопления очереди.

Esc или «Остановить» отменяет поиск/preview и все ещё не отправленные участки.
Уже отправленный участок может завершиться: остановка имеет дискретность до 72
единиц (около 200 мс анимации плюс ожидание сети). Это настоящая промежуточная
canonical позиция, а не остановленный sprite при server endpoint в конце маршрута.
Reload не возобновляет оставшийся путь. Новое pointer-действие/targeting, геометрия,
смена Scene/хода, исправление позиции или размера токена прекращают продолжение.

В Combat остаётся подтверждение всего предложенного пути, но бюджет и события
принимаются только для исполненных участков. Preview суммирует стоимость участков
с существующим округлением TurnBudget вверх до 0.0001 ft, поэтому полная сумма
может незначительно отличаться от стоимости одной неделимой команды. Esc не
возвращает уже потраченный бюджет. Непройденные Regions не получают событий;
once/cooldown применяются на времени принятия каждого участка. Automatic stop-on-enter
и реакции не добавлены, Cue Engine не переписан.

Проверки обновлённого поведения: 313 frontend tests; 27 backend tests / 408 assertions
(Movement/Triggers/Combat/DirectControl), production build и ESLint. Новый browser
сценарий `node scripts/qa/map07-stop.cjs` использует GM + 2 Players и Scene 5,
восстанавливает позиции, grid, Combat и исходную активную Scene.
Артефакты: `artifacts/map07e3/stop/`. Старые E.3 видео/покадровые скорости относятся
к прежней версии 180 ед/с; старые browser scripts, ожидающие весь Click-to-Move path
в первом receipt, требуют адаптации к последовательному исполнению.

### Уточнение Drag — доступный обход препятствия

Одиночный normal Drag в MapWorld после drop использует тот же Worker/A* и footprint,
что Click-to-Move. Отправляется весь найденный маршрут одной командой с `instant=true`,
без `routeStep` и без walk animation. Препятствие на прямой линии больше не означает
недоступность точки, если существует допустимый обход. Laravel проверяет все сегменты,
расход и Regions/Triggers; скрытая геометрия по-прежнему может отклонить публичный путь
нейтральным ответом. Цель внутри стены/obstacle остаётся недоступной.

Drop является подтверждением Drag, в том числе Combat: стоимость полного обхода
проверяется до отправки и повторно сервером. При недостатке бюджета команда не
отправляется. Esc может отменить поиск, но уже принятое мгновенное перемещение не
отзывается. Click-to-Move сохраняет последовательное исполнение и остановку Esc.
Legacy map, explicit GM override и групповой translation Drag сохраняют свои контракты;
автоматический обход здесь добавлен для одиночного токена.

Проверено: 316 frontend tests, production build, ESLint. Browser GM + 2 Players:
Player Drag через прямую стену при доступном обходе, instant endpoint на всех клиентах,
отказ цели внутри стены без команды, Combat spend по длине detour. Исходные позиции,
геометрия, grid, подготовленный Combat и активная Scene восстановлены.
Сценарий: `node scripts/qa/map07-drag-route.cjs`; отчёт и screenshot:
`artifacts/map07e3/drag-route/`. Ручная Scene 7 не изменялась.

### Живое превью маршрута во время Drag

Во время одиночного normal Drag в MapWorld линия теперь показывает результат того же
pathfinding Worker, который выбирает обход после drop. Длина подписи считается по
полилинии, а в Combat цвет учитывает полную стоимость обхода и текущий TurnBudget.
До получения результата показывается только маркер цели; недоступная цель отмечается
красным, без ложной прямой траектории через стену.

На жест создаётся один последовательно используемый Worker. Запросы ограничены
интервалом 80 мс; во время расчёта хранится только последняя цель. Устаревшие ответы
не рисуются. Изменение scene/token/budget инвалидирует результат; drop, Esc, blur,
отмена жеста и teardown освобождают Worker и таймеры. Preview не отправляет movement
commands. GM override и legacy/group Drag сохраняют свои существующие preview contracts.

Проверено: 320 frontend tests; production build и ESLint. Browser сценарий
`map07-drag-route.cjs` во время удержания мыши проверяет полилинию обхода, отображаемую
длину и совпадение с принятым path после отпускания; также недоступную цель и Combat.
GM + два Players синхронизированы, JavaScript errors 0, исходный полигон восстановлен.
Снимки: `artifacts/map07e3/drag-route/live-preview-0.png` и `live-preview-2.png`.

## MAP-08B — Player Vision 360°

### Настройка и совместимость

Player Vision включается GM для конкретной Scene: **Map Editor → LOS → Обзор
игроков**. Для выбранного наблюдателя кнопка «Сохранить дальность персонажа»
сохраняет `Token.vision_range`: 0–40000 мировых единиц, по умолчанию 600.
Это явная настройка GM, без вывода Darkvision, освещения или правил системы.
`Scene.vision_enabled` по умолчанию false, поэтому существующие сцены и ручной
Fog сохраняют прежнее поведение. Поддерживаются MapWorld и legacy Scene.

Наблюдатели Player — все принадлежащие ему `player_character` токены этой
Scene, кроме GM-hidden. Выбор активного персонажа, rotation, направление
движения и спрайта не меняют обзор. Области объединяются; это личный обзор
игрока, а не автоматически общий обзор всей партии. Без наблюдателей или при
нулевой дальности маска закрыта. GM видит всю Scene; заливка в LOS debug
показывает серверный polygon выбранного токена, поверх точных LOS-замеров.

### Геометрия и маска

`VisibilityPolygon` использует тот же `StructuralGeometry`/`blocksVision`, что
MAP-08A, включая hidden props. Угловые события включают углы полигонов,
плоские jambs, круглые торцы и точные касательные transformed ellipses.
Контакты лучей с отрезками/эллипсами аналитические; MAP-08A epsilon проверяется
точным LOS, с уточнением первого контакта при касании. Broad phase ограничен
дальностью и 512 угловыми секторами. Адаптивное уточнение между событиями
обрабатывает пересекающиеся силуэты; прямые участки сокращаются без сглаживания
проёмов. Кривые и окружность дальности имеют субпиксельную мировую аппроксимацию
(шаг уточнения .15 world units), а не зависят от камеры.

Player получает только результирующие polygons, без observer IDs, blocker IDs,
geometryKey, private colliders и vision/light flags. Существующая публичная
структура стен и movement-проекция уже видимых props остаются контрактом MAP-07;
новая приватная геометрия для клиентского LOS не передаётся. Статические map и
material assets по-прежнему доставляются для рендера; маска не шифрует их.

`PlayerVisionLayer` объединяет polygons на одной GPU RenderTexture, ограниченной
4096 px по длинной стороне, с antialias. Маска обновляется только при новой
серверной проекции/размере мира. Камера и render ticker ничего не рассчитывают.
Она закрывает пространство вне текущего обзора; существующий Fog независимо
закрывает вручную выбранные участки. Видимый результат — пересечение двух
масок. Vision не стирает Fog, не сохраняет территорию и не добавляет explored areas.

### Серверная граница

Request-scoped `SceneVisibility` использует coherent Scene revision. Для токенов
применяется консервативная политика **точный center-to-center LOS + range** от
хотя бы одного наблюдателя; собственные доступные токены известны владельцу.
Это осознанно отличается от диагностического `inset-disc-9-v1` MAP-08A:
дискретные footprint samples не используются как security boundary. Токен с
видимым краем, но закрытым центром пока не раскрывается. Для prop проверяется
центр, причём первый контакт с его собственным collider считается видимой
передней поверхностью. GM-hidden всегда имеет приоритет.

Фильтрация применяется к snapshots, CombatView, targeting/area candidate lists,
interactions, stabilization, loot, feedback, изображениям/thumbnail/media и
повторным mutation receipts. Preload для Vision Scene не включает token/prop
assets: предварительная загрузка не раскрывает ещё неизвестные сущности.
Старый GM-hidden 403-контракт сохранён; недоступная по обзору цель даёт 404.
Устаревший Player receipt с прежней маской отклоняется 409; клиент синхронизируется.

Writers сравнивают безопасные проекции до/после mutation под существующими
campaign → scene locks. Персональные Reverb events содержат только изменённые/
раскрывшиеся entities и удаления ранее доставленных IDs, а не полный snapshot.
Movement, rotation-independent observer range/ownership, стены, двери и props
инвалидируют соответствующий обзор. Polygon отправляется только при смене
observer/geometry signature; HP, камера и frames его не пересчитывают.
Чужие пути и transient move previews в Vision Scene не передаются Player:
видимые конечные позиции приходят через delta. Собственный WASD/Click-to-Move
сохраняет обычный authoritative receipt и playback. Удаления и ограничение маски
применяются даже при ожидающем movement receipt; поздний ответ не возвращает
ранее скрытые entities. Reconnect восстанавливает актуальную маску со snapshot.

### Проверки и артефакты

- `PlayerVisionTest`: 360°, личные наблюдатели/union, zero observers, двери,
  permissions, incremental reveal/remove, range/movement receipts, targeting,
  Combat, assets/preload и stale replay. Polygon проверяется по внутренним
  точкам и точному LOS; отдельные диагональные проёмы 20 и .05 единиц с точками
  в .0002 от jamb, углы, повёрнутый ellipse и вогнутый prop.
- Frontend: reducer/store/reconnect и immediate revocation при pending WASD,
  включая поздний HTTP receipt. Общий suite: 324 tests / 63 files.
- Backend: полный suite — 388 tests / 12359 assertions; build и ESLint проходят.
  После финального уточнения viewer/caching также повторены затронутые tests.
- `node scripts/qa/map08b.cjs`: существующие GM + 2 Players на Scene 7,
  прозрачное/непрозрачное окно, стены/двери/props, GM-hidden, union, настоящий
  WASD и double-click Click-to-Move, reconnect, API privacy, Reverb и GM debug.
  Изменённые позиции, ownership, ranges, geometry, grid, activation и включение
  Vision восстанавливаются; точные проекции сверяются. Никаких новых fixture
  аккаунтов, кампаний, сцен или sessions не создаётся.
- `php scripts/qa/vision-benchmark.php`: 500 blockers, 12 observer queries,
  range 600; отдельный pure-geometry benchmark, без DB/HTTP/GPU. JSON с временем,
  памятью, числом вершин и проверкой boundary LOS сохраняется в
  `artifacts/map08b/benchmark.json`. Browser report отдельно измеряет CPU submission
  маски в Pixi; это не GPU timer query и не обещание production latency.
  Локальный результат: compile 2.76 мс, median 36.66 мс, p95 47.86 мс на
  observer, максимум 395 вершин, peak 12 MiB, 0 boundary LOS mismatches.
  В браузере два измеренных обновления маски: около .4 мс CPU submission каждое.
- Реальные screenshots: `artifacts/map08b/player1-door-closed.png`,
  `player1-door-open.png`, `player2-window.png`, `player1-observer-union.png`,
  `gm-vision-debug.png`; отчёт — `artifacts/map08b/report.json`.

MAP-09, explored areas, память территории, Fog v2, Dynamic Lighting,
Darkvision и Cover не реализуются в MAP-08B.

## MAP-09 — Fog of War v2

### Память территории и политика

При включённом Player Vision Fog v2 использует готовые 360° polygons MAP-08B
как current visibility. `fog_memories` хранит только разведанную территорию:
`scene_id + scope`, размеры raster, `cell_size` и base64 bitset. Сетка привязана
к world origin; ячейка `max(4, ceil(max(width,height)/512))` world units, длинная
сторона не больше 512 cells. Максимум 32 KiB raw / 43 KiB base64 на scope.
Scan conversion отмечает centers cells внутри серверных visibility polygons;
области монотонно объединяются. Entity IDs, картинки сущностей, private geometry
и исторические состояния дверей в памяти отсутствуют.

`Scene.fog_memory_policy` по умолчанию `player`: каждый участник сохраняет
территорию от всех своих доступных player_character observers. GM может выбрать
`party` в **Map Editor → LOS → Память карты**: общий накопленный scope партии,
но current vision, entities, targeting и права остаются личными. Party начинает
запоминать текущую территорию при включении; старые личные карты автоматически
не объединяются. Личная память продолжает накапливаться и в party mode; возврат
к личной политике не копирует общую память. Общая память сохраняет историю партии,
включая территорию прежних участников. Наличие открытого браузера не требуется.

Память записывается под campaign → scene locks в той же транзакции, что движение,
двери, изменения геометрии или настройки Vision, **до** построения персональных
realtime delta. Пересчитываются изменившиеся наблюдатели; HP, камера и frames
не обновляют территорию. Snapshot также инициализирует текущую память под такими
же locks. Reconnect и Scene activation восстанавливают отдельный scope этой Scene.
При изменении размеров raster/cell size несовместимая память безопасно начинается
заново; изменение мира с сохранением той же сетки оставляет world-aligned cells.
Отключение Vision сохраняет память. GM может явно сбросить все scopes текущей
Scene кнопкой **Сбросить память карты…**; при включённом Vision текущий обзор
сразу запоминается снова. Endpoint настроек/сброса остаётся GM-only.

### Три состояния в Pixi

- **Visible:** фон без затемнения, доступные entities и интерактивы в текущей маске.
- **Explored:** фон с затемнением около 62%, без актуальных entities/дверей вне обзора.
- **Unexplored:** затемнение около 94% оттенком `#0b1119`, без абсолютного чёрного;
  слабо читаются уже публичные map/terrain/floor assets и статическая кладка стен.

Фоновая кладка использует только существующую публичную structure projection;
из неё исключены все door/window leaves и их текущее состояние. Props, tokens,
интерактивные двери/окна, spatial/selection и gameplay feedback находятся в
отдельном current container с точной маской MAP-08B. Они не становятся силуэтами
даже при краях/анимации. GM не получает эти ограничения.

Fog и current mask — две antialiased RenderTextures до 4096 px по длинной стороне.
Память растеризуется отдельно до 512 cells и билинейно масштабируется: мягкий
переход шириной около одной cell, без blur filters, ticker/per-frame LOS и камеры
в вычислении. Отзыв current visibility применяется сразу, без fade старых entities.

### Manual Fog, privacy и границы перед Lighting

Существующий manual Fog сохраняется как независимый верхний слой: legacy
операция `reveal` стирает ручную маску, `cover` закрывает visible/explored/unexplored.
Старые actions/base
не мигрируются и не стираются; при выключенном Vision сохраняется legacy workflow.
Manual Fog по-прежнему визуальный инструмент GM, не server-side authorization.
Он не останавливает запоминание территории, которую физически видят observers.

Серверная фильтрация MAP-08B остаётся границей безопасности на snapshots/events,
receipts, interactions, targeting, combat, preload и media. Память её не расширяет:
игрок получает только свой/общий bitset и current polygons. Hidden props/colliders
не используются в фоне; GM-hidden сущности не доставляются. Статические assets
и публичная структура остаются прежним публичным контрактом: Fog не шифрует их
и не скрывает секреты, заранее нарисованные в самом фоновом изображении.

Память — карта разведанной территории, не исторический screenshot мира: изменения
публичного статического фона могут отражаться и в dimmed областях. Память entities,
последнее известное состояние дверей, secret structural topology, Dynamic Lighting,
Darkvision, ambient darkness и Cover не добавлены. LOS и vision range не переписаны;
будущему Lighting нужен отдельный контракт current visibility, без стирания
сохранённой географической памяти.

### Проверки

- `FogExplorationTest`: личная/общая память, отсутствие расширения текущего обзора,
  движение, закрытие дверей, reload, GM reset, permissions, изоляция Scene,
  disabled Vision и coexistence с manual Fog. Регрессии `PlayerVisionTest` и
  `TokenMovementTest` проходят (финальный профильный прогон: 17 tests).
- Полный backend прогон перед финальными дополнениями: 391 tests / 12395 assertions;
  финальные профильные проверки: 17 tests / 6945 assertions. Frontend: 326 tests /
  64 files; build, TypeScript, ESLint проходят.
- `node scripts/qa/map09.cjs`: существующие GM + 2 Players Scene 7, три состояния,
  двери/окна, личная/party memory, API/Reverb/media privacy, настоящий Drag/WASD/
  double-click Click-to-Move, reconnect и Scene 5 → 7. Positions, ownership, ranges,
  structure, activation, grid, Vision settings и исходная fog memory восстанавливаются.
  `fog-memory-fixture.php` временно сохраняет только memory rows Scene 7 в private
  storage; при прерванном запуске `php scripts/qa/fog-memory-fixture.php restore`
  восстанавливает этот снимок. Новых fixture entities нет.
- Screenshots и отчёт: `artifacts/map09/`. GPU readback проверяет alpha fog:
  visible 0, explored 158, unexplored 239 из 255; current entity mask вне обзора 0.
  Время `gpuMaskSubmissionMs` — CPU submission отдельных render passes, не GPU timer.

## MAP-09.1 — Movement × Vision Performance & Synchronization

### Причины и границы изменений

Browser baseline на постоянной Scene 7 воспроизвёл остановку WASD после одного
шага (~36 world units) и длинного Click-to-Move после первого участка (72).
Пустые object deltas заменяли `props`, а смена recipient projection при движении
убирала/добавляла colliders. Input controllers принимали эти изменения за правку
геометрии. Счётчик ~120 FPS при уже остановившемся движении скрывал проблему.
У второго Player отфильтрованные observers сохраняли индексы PHP Collection:
`polygons` мог сериализоваться как object и останавливать Pixi с TypeError.

В HTTP pipeline значительную стоимость давали повторные Character `checkStats`
и нормализация rules в DTO, а не пересчёт LOS на каждом кадре. Маска переключалась
на accepted endpoint отдельно от token playback; Fog memory перестраивала Graphics
и выделяла новый RenderTexture при обновлениях территории.

### Контракт движения и проекций

`SceneVisibility::movementGeometryKey` сравнивает compiled movement blockers,
размеры/наличие MapWorld и grid до/после мутации под существующими writer locks.
Сам fingerprint не передаётся клиенту. Incremental event/receipt содержит только
`movementGeometryChanged`: projection churn без реальной правки препятствий
не отменяет маршрут. Без hint сохраняется прежняя консервативная клиентская
проверка. Реальная правка немедленно завершает control/route, в том числе при
pending HTTP receipt и нескольких событиях между Pixi ticks. WASD обновляет
локальный набор уже доставленных препятствий при изменении projection; сервер
по-прежнему валидирует каждый следующий шаг, включая приватную геометрию.
Пустые дельты сохраняют identity коллекций. Polygons каждого получателя — JSON list.

Visibility имеет отдельный revision watermark: более ранний buffered event или
HTTP receipt не возвращает отозванную маску/сущности. При этом разрешённая и уже
принятая собственная позиция может завершить receipt, не прерывая control из-за
более нового visibility-only события. Scene hydration сбрасывает watermark.
Обычные queued Move receipts используют тот же bounded merge, что WASD: чужие
Reverb deltas упорядочиваются до/после receipt, вместо forced snapshot во время
SaveQueue. Поиск и остаток Click-to-Move переживают безопасную чужую revision,
если собственный Token и боевой бюджет неизменны; worker сохраняет свой context.
Реальный gap/переполнение buffer по-прежнему приводит к snapshot recovery.
Новая маска, полученная до своего receipt, сразу отзывает visibility, но её новые
области ждут accepted playback. Поздний path присоединяется без нового raster pass.

`SpellEffects::project/read` переиспользует нормализованные rules и `checkStats`
только внутри одной неизменяемой сборки DTO. Before и after имеют разные scopes;
между командами cache отсутствует. Permissions и viewer-specific token fields
остаются в существующих DTO/authorization builders. Combat Player DTO не загружает
скрытый preparing combat со всем roster без необходимости.

### Pixi и приватность перехода

`PlayerVisionLayer` переиспользует две antialiased current surfaces. Polygons
растеризуются только при изменении содержимого или размеров. Explored bitset
обновляет один `BufferImageSource`, без row-run Graphics и RT allocation на шаг.
Фиксированный composite quad читает current/previous/memory; ticker меняет только
uniform прогресса. Ни LOS, ни explored memory не вычисляются на render frames.

Новые области проявляются в пределах последней серверной current mask; прогресс
привязан к визуальному прохождению accepted polyline и ограничен коротким easing.
Polygons не перемещаются и не интерполируются. Живые entities всегда обрезаны
точной новой current mask, а удаления применяются сразу. Плавно темнеть может
только публичная подложка, уже разрешённая новой explored memory и прошлой маской;
это не сохраняет изображения entities/состояния дверей. Reset memory немедленно
отзывает и это разрешение. Без explored memory старый обзор не удерживается.
Manual Fog остаётся независимым верхним слоем.

### Воспроизведение и evidence

- `node scripts/qa/map09.cjs`: GM + два существующих Players, оба WASD workflows,
  Click-to-Move/drag, двери/окна, union, current/explored/unexplored, manual Fog,
  party/personal memory, privacy, reconnect/activation, GPU readback и teardown.
- `node scripts/qa/vision-motion.cjs final-verified`: три режима (без Vision/Fog,
  Vision без exploration, Vision + Fog), WASD и маршрут 800 units, zoom 29/50/100%.
  Только локальный opt-in `X-YTT-Perf` разрешает diagnostics header отключения
  exploration для A/B; production/current visibility этим не расширяются.
- `node scripts/qa/vision-motion-report.cjs final-verified`: сопоставляет исходный
  `before-clean` с финальным прогоном, сохраняет aggregate/per-role comparison и
  безопасные server spans/counts. Исходный broken baseline имеет мало команд,
  поскольку input останавливался; его idle FPS нельзя выдавать за качество движения.
- Capture выполняется отдельным прогоном с `YTT_MOTION_CAPTURE=1`, чтобы GPU
  readback screencast не искажал основной benchmark. JPG + timestamps сохраняются
  для всех трёх ролей. Это реальный Chromium, а не синтетический renderer test.
- Артефакты: `artifacts/vision-motion/comparison.md`, `comparison.json`,
  `final-verified/`, `captures-final/`, `artifacts/map09/report.json` и screenshots.
  `maskPassCpuMs` — CPU submission, не GPU timer query. Frame-time включает
  реальные browser stalls. Измерения относятся к этому native стенду и Scene 7.

HTTP transport остаётся bounded: 200 мс cadence, один запрос в полёте, privacy
collision padding и backpressure не сняты. На большом RTT/перегруженном единственном
Windows HTTP worker скорость может снижаться; очередь неподтверждённых шагов не
накапливается. Это не переход к новому движку, prediction authority или MAP-10.

Финальный native Chromium 156, GM + 2 Players, агрегат по zoom 29/50/100%:

| Режим / ввод                   | FPS Player 1 | frame p95 / p99, ms | HTTP p50 / p95, ms |
| ------------------------------ | -----------: | ------------------: | -----------------: |
| Без Vision/Fog · WASD          |        118.5 |          9.5 / 11.0 |      143.8 / 208.5 |
| Vision без Fog · WASD          |        118.8 |          9.6 / 10.8 |      213.5 / 258.6 |
| Vision + Fog · WASD            |        115.9 |         10.2 / 11.2 |      215.0 / 277.0 |
| Без Vision/Fog · Click-to-Move |         77.0 |         15.6 / 17.0 |      140.2 / 167.9 |
| Vision без Fog · Click-to-Move |         76.2 |         15.8 / 16.6 |      203.6 / 381.2 |
| Vision + Fog · Click-to-Move   |         74.8 |         15.9 / 16.8 |      210.0 / 250.9 |

С исходным Vision + Fog baseline: WASD 33.9 → 401.5 units за одинаковое окно
удержания, max frame position jump 70.9 → 3.0, обратные скачки 3 → 0.
Click-to-Move 72 → ~799 units, все три длинных маршрута завершены. HTTP p50
283.4 → 215.0 ms (WASD), 306.5 → 210.0 ms (Click-to-Move). Исходный baseline
обрывался: всего 3 команды на три масштаба; его ~120/107 FPS — преимущественно
idle, а не плавное движение. GM и второй Player измерены отдельно в comparison.

LOS остаётся domain-driven: 1 build на принятый moving command, 0 на idle/camera
frames; p95 на этой Scene 7.7/7.6 ms (WASD/Click-to-Move). Fog record p95
9.8/9.4 ms включает вложенный LOS; spans нельзя суммировать.
Персональная projection p50 снизилась с 64–68 до 27–29 ms. Маска вместо 2–3 CPU
render submissions на обновление делает один, p95 0.3–0.4 ms; memory RT allocations
на шаг отсутствуют. Frame-time включает GPU/браузерную работу, submission отдельно
не измеряет GPU execution. JS errors: 2 в исходном baseline, 0 в финальном.

WebGL QA: 40 переключений используют 2 mask textures и 1 memory texture;
после destroy живых источников 26 → 26. Неавторизованных прозрачных пикселей 0;
playback pending/completed alpha 158/0, live revoke 0, memory reset background 240.
Listeners после трёх reconnect/reload + GC стабильны: Player 1 — 279, Player 2 — 293.
Длинный маршрут на фоне четырёх чужих Reverb revisions завершён без snapshot reset (0).

Backend 395 tests / 12428 assertions, frontend 338 tests, build/lint проходят.
Исходные tokens/grid/activation, exploration и manual Fog восстановлены.

Отдельный повтор под конкурирующей CPU/GPU нагрузкой поймал запрос 1002 ms
(SQL, LOS и Reverb одновременно замедлились). Штатный 900 ms WASD timeout безопасно
остановил control и запросил серверную позицию. Trace сохранён в
`artifacts/vision-motion/timeout-spike/`; переходный прогон — `load-transition/`.
После снятия конкурирующей нагрузки повторены все 18 сценариев, все assertions
прошли. Нагрузочный timeout не скрыт и не смешан с основным сравнением. Увеличение
prediction/timeout budgets ради маскировки такой перегрузки не выполнялось.

### Уточнение взаимодействия Click-to-Move (2026-11-05)

Первый клик по свободной точке при выбранном токене показывает маршрут; повторный
клик туда же (допуск 5 экранных пикселей) подтверждает движение, в исследовании
и в бою. Быстрый double-click сохраняется: подтверждение ждёт завершения поиска.
Другая точка заменяет preview, Esc отменяет его. Drag сохраняет прежнее поведение.
Локальные направляющие движения рисуются поверх LOS и ручного Fog; содержимое
сцены по-прежнему ограничено серверной проекцией и маской текущего обзора.

## MAP-10A — визуальное динамическое освещение

`Scene.lighting` — необязательные настройки: enabled, day/night preset,
ambient brightness/color и до 16 источников. У источника есть radius в world units,
color, intensity, falloff и необязательная привязка к Token. Удалённая привязка
инертна; GM-hidden emitter игрокам не передаётся. Старые Scene по умолчанию
сохраняют прежний вид: свет выключен.

**Map Editor → Свет**: предпросмотр ambient, День/Ночь, список источников,
размещение кликом на карте, привязка к выбранному токену, радиус/цвет/интенсивность/
затухание. Сохранение проверяет ожидаемые настройки и сообщает о конфликте
между окнами. Черновик и направляющие GM не являются shared state.

### Геометрия, приватность и transport

- `StructuralGeometry` остаётся общим компилятором стен, проёмов и transformed
  prop colliders. Для света выбирается только `blocksLight`; существующий
  `VisibilityPolygon` используется с отдельным набором blockers. `blocksVision`,
  серверная видимость, Combat и targeting не изменены. Закрытая дверь блокирует
  свет, открытая освобождает проём; у окна действует собственный `blocksLight`.
- Игрок получает только raster-маски разрешённых источников, пересечённые
  **на сервере** с его current visibility. Ни topology, ни collider IDs, ни
  неразведанные shadow polygons не отправляются. Для публичного источника вне текущего обзора передаётся только обезличенное
  RGB-освещение внутри current visibility: без ID, центра или параметров источника.
  GM-hidden emitter не вносит даже такого вклада.
- Initial/reconnect read: `GET /api/scenes/{scene}/lighting`; GM settings:
  idempotent `PUT` с expected-value conflict check. Membership/active Scene и
  право GM проверяются существующими policies. Полные definitions есть только у GM.
- Принятая команда только ставит coalesced `RefreshSceneLighting` в очередь
  `lighting` на существующем MySQL connection `tabletop`. Тени/растер/DTO не
  вычисляются в Movement transaction. Pending jobs объединяются по Scene,
  worker читает последнюю committed revision, без FOR UPDATE и записи Fog.
- `lighting.frame` идёт по существующим private recipient channels как отдельное
  visual событие. Оно не меняет Scene revision, SaveQueue, route context или
  React snapshot. Старые/чужие frames отбрасываются; snapshot hydration сбрасывает
  stream и получает свежую проекцию. Cue остаются первыми в `--queue=cues,lighting`.
- Сервер переиспользует silhouettes неизменённых источников, bounded cache record
  на Scene и byte-RLE масок. Исключительно большой frame использует read fallback.

### Pixi и композиция

Lightmap — одна переиспользуемая RenderTexture, не более 1024 pixels по длинной
стороне. Source masks ограничены 384 pixels по длинной стороне; bilinear sampling
смягчает края теней. GPU считает цветной radial falloff и additive union в
прямоугольнике радиуса каждого источника, без полноразмерного прохода на факел.
Для невидимых публичных emitters фоновой job дополнительно собирается одно
обезличенное RGB-поле; native async inflate и переиспользуемая BufferTexture
смешивают его с обычными GPU источниками. Один multiply composite применяется
к карте, props и токенам **до** Fog v2 и
Manual Fog. Это мягкие raster edges, не физическая penumbra/area lights.

У игрока composite дополнительно обрезан точной current mask MAP-09.1. Explored
подложка не хранит исторические изображения источников/сущностей. Радиальный
центр привязан к тому же визуальному Token playback; shadow masks обновляются
по accepted state. Render frames не запускают LOS или HTTP. Offscreen pass идёт
только при изменении света, маски или положения emitter; idle/pan/zoom его не
вызывают. Textures переиспользуются, pool ограничен 16 emitter resources и
освобождается при destroy. При выключенном свете shaders/RT не создаются.

### Проверка

`node scripts/qa/map10a.cjs` — обратимый native Chrome GM + два Players,
дверь/окно, Fog, WASD/Click-to-Move, GPU pixels/idle, GM editor и реальные
Flinns Townhouse day/night screenshots. Все правки fixture восстанавливаются;
browser закрывается также при ошибке restore. `--restore` читает приватный backup
этого QA, если процесс был прерван.

Performance: `vision-motion.cjs map10a-final` с `YTT_MOTION_MODES=fog` и
`YTT_MOTION_LIGHTING=1`, zoom 29/50/100%, пять источников включая движущийся.
Контроль без света — `map10a-control-clean`; исходный MAP-09.1 — `final-verified`.
`lighting-motion-report.cjs` собирает per-role frame/HTTP/movement/GPU-submission
сравнение в `artifacts/map10a/performance.md` и JSON, без readback в измеряемом окне.
Подробные результаты: [MAP10A_VALIDATION.md](MAP10A_VALIDATION.md).

## MAP-10B — освещение и зрение персонажа

Правила действуют при одновременном включении **Света** и **Обзора игроков**.
Старые сцены без освещения, сцены с одним только визуальным светом и ручной
Fog сохраняют прежнее поведение. GM продолжает получать полную сцену. При
низком ambient слабая подсветка на карте GM сохраняет читаемость пола и стен.
Уровни света для правил и изображение игроков рассчитываются отдельно от неё.
В полной темноте видимый игроку край факела сохраняет читаемость рядом с
памятью Fog. Подсветка действует внутри текущей маски.

- Ambient от 50% даёт яркий свет, от ненулевого значения до 50% — тусклый,
  при 0% за пределами локальных источников темно. День/Ночь задаёт ambient
  через прежние пресеты.
- Активный источник с положительной интенсивностью даёт тусклый свет до
  внешнего радиуса. При интенсивности от 0.5 его внутренняя половина яркая.
  В точке действует наибольший доступный уровень. Цвет, мягкое затухание и
  смешивание цветов остаются визуальными настройками MAP-10A.
- Обычное зрение различает цели в ярком и тусклом свете при открытом LOS.
  **Характеристики → Тёмное зрение, футы** задаёт дальность Darkvision
  персонажа. Она переводится через масштаб линейки сцены, где 1 клетка
  соответствует 5 футам в режиме «клетки», и ограничивается дальностью
  Player Vision токена. Обзор круговой. В радиусе Darkvision тусклый свет
  считается ярким, темнота — тусклым монохромным обзором. Явно зависящие
  от зрения проверки Восприятия по цели получают помеху в воспринимаемом
  тусклом свете и автоматически проваливаются, если актёр не видит цель.
- Луч наблюдателя проверяет `blocksVision`, луч источника — `blocksLight`.
  Открытие двери обновляет обе проверки. Окно может пропускать одну и
  блокировать другую. Свет GM-hidden токена учитывается только у GM.

Выдача токенов, props, разрешения на ассеты, targeting и Reverb используют
точные проверки серверного LOS и света по принятой ревизии. Скрытие отзывается
в той же ревизии и действует при reconnect. Для заклинаний с явным требованием
зрения проверяется также обзор самого актёра при выборе токена, объекта или точки.
Fog сохраняет только территорию. Старые открытые клетки не раскрывают токены
после выключения света. Публичная геометрия движения сохраняет прежний формат.

При ненулевом ambient путь масок остаётся полигональным. При темноте
сервер пересекает существующие LOS-полигоны с общим полем локального света и
добавляет ограниченный LOS Darkvision. Клиент получает только разрешённый
битовый растр, который использует те же две поверхности Fog и тот же playback.
Силуэты статических источников переиспользуются. Свет вне дальности наблюдателя
не инвалидирует его маску. В темноте движение источника синхронно обновляет
только его силуэт, необходимый для авторизации Fog; цветное поле и DTO остаются
в очереди MAP-10A. Монохромная композиция включается только для игрока с
разрешёнными клетками Darkvision.

Вне текущего прохода остаются Cover, автоматические источники от заклинаний,
магическая тьма и MAP-07E.2.

Браузерный QA на Scene 7 прошёл с GM и двумя игроками. В финальном сравнении
на 29/50/100% p95 кадра у движущегося игрока в темноте составил 10.7 мс
на WASD и 17.1 мс на Click-to-Move. На MAP-10A было 10.5 и 16.3 мс.
Все длинные маршруты завершились, обратных скачков и сбросов не было.
Детализация, данные по ролям и контроль без света находятся в
`artifacts/map10b/performance.md`. Команды запуска описаны в
[TEST_PLAYGROUND.md](TEST_PLAYGROUND.md).

### MAP-P2A — Fantasy Classic — Stone & Timber

Встроенные стены, полы, двери и окна доступны после
`php artisan ytt:install-fantasy-classic`. Состав, форматы и происхождение
растров описаны в [паспорте набора](../resources/architecture/fantasy-classic/README.md).
Оригиналы доступны в Global Assets → «Архитектура». Material Library показывает
встроенные определения рядом с личными и позволяет создать редактируемую копию.

В Build стиль двери или окна можно выбрать при размещении и в инспекторе.
Стиль сохраняется как ссылка на неизменяемую версию материала, включая
проёмы в исходниках объединённых комнат. Старые проёмы используют прежнее
оформление. Стены с форматом «Укладывать вдоль стены» получают повтор по длине
прямого или кривого участка и отдельную координату поперёк полосы. Полы
сохраняют общую мировую привязку. Рамы проёмов выравниваются по хорде, а
открытая створка учитывает петлю, сторону и угол.

Пример расположен на Scene 10 «Лесная таверна» в существующем основном здании
и его пристройках. Для повторной Chromium QA используйте
`node scripts/qa/map-p2a.cjs`. Параметр `--apply` назначает материалы
существующей геометрии Scene 10. Снимки и отчёт сохраняются в
`artifacts/map-p2a/`.

### MAP-P2B — Terrain, Lighting и Fog

Terrain смешивает два повтора текстуры с разными углами и масштабами.
Доля каждого повтора меняется в мировых координатах, поэтому доминирующее
направление травы, грунта и дорожек меняется по карте. Переходы материалов
используют общий сдвиг выборки альфа-масок. Границы тайлов совпадают, а
детали исходных текстур сохраняются.

В существующей lightmap оставлен запас для смешивания источников. Композиция
плавно сжимает яркие пересечения и сохраняет тёплый и холодный оттенки.
Края растровых теней смягчаются в пределах имеющегося покрытия. Ambient
по-прежнему задаётся GM в настройках сцены. При низком ambient тени у GM
сохраняют читаемый силуэт архитектуры. Для игрока локальный свет применяется
в пределах текущего обзора. Граница композиции Fog и света использует одно
сглаживание, а исследованная карта имеет стабильный тон вне текущего обзора.

Серверные маски, фильтрация объектов, Darkvision, сохранение Fog memory
и ручной Fog работают по прежним правилам. Дополнительных render targets
нет. Размер растровой ячейки ограничивает плавность теней на крупных сценах.

Парная проверка `node scripts/qa/map-p2b.cjs before` на сборке MAP-P2A и
`node scripts/qa/map-p2b.cjs after` на MAP-P2B сохраняет Chromium-снимки
сцен 8–10 при 50% и 100%, с GM и Player, для дня, вечера и ночи с локальным
светом и без него. Отчёт и снимки находятся в `artifacts/map-p2b/`.

### MAP-P2C — Fantasy Classic — Environment & Props Pack

`php artisan migrate --seed` устанавливает Stone & Timber, 20 пресетов
окружения и четыре покрытия Terrain. На мигрированной базе можно выполнить
`php artisan ytt:install-fantasy-classic`. Состав и права перечислены
в [паспорте набора](../resources/environment/fantasy-classic/README.md).

В Map Editor → Objects → Object Presets доступны карточки с изображением,
категорией, размером и признаками коллизии и света. Выберите Fantasy Classic
и категорию или введите название. После выбора карта показывает изображение
под курсором. Клик повторно ставит экземпляр. Кнопки и `[` / `]` меняют
масштаб, `R` / `Shift+R` поворачивают на 15°, `Esc` завершает размещение.
Встроенный пресет можно скопировать в личную библиотеку.

Осветительный пресет использует штатный свет сцены. Если динамический свет
включён, источник движется вместе с объектом и участвует в его Undo/Redo.
Скрытый объект гаснет. Из 16 активных источников приоритет у ручных,
остальные места занимают светящиеся объекты в порядке размещения.

Приёмка на отдельной сцене «Лесная таверна · Fantasy Classic» в кампании
полигона. Браузерный сценарий `node scripts/qa/map-p2c.cjs` сохраняет реальные
снимки и замеры в `artifacts/map-p2c/` и восстанавливает активную сцену.

Художественная ревизия `v1-top-down` обновляет 11 спрайтов окружения
до ортографического вида сверху. Seed переключает встроенные Asset на
ревизию файла вместе с его миниатюрой. ID ресурсов и настройки пресетов
и экземпляров остаются прежними. Для сравнения Scene 11 используйте
`node scripts/qa/fantasy-classic-top-down.cjs before` перед установкой и
`node scripts/qa/fantasy-classic-top-down.cjs after` после неё.

## FOG-UX-01 — ручной туман в редакторе и сессии

В редакторе откройте **Туман**, в сессии нажмите значок тумана или **F**.
Выберите **Скрыть**, **Стереть** или **Раскрыть**, затем кисть или прямоугольник.
Кисть рисует непрерывно, её диаметр задан в координатах карты. Форма и диаметр
сохраняются локально в браузере. Жест применяется
при отпускании кнопки мыши. Esc отменяет жест, следующее нажатие возвращает к
выбору. Пробел и средняя кнопка мыши по-прежнему перемещают камеру.

- **Скрыть** накладывает ручную маску поверх автоматического обзора.
- **Стереть** возвращает выделенную область под действие LOS и памяти. Для
  совместимости команда по-прежнему хранится как `reveal`.
- **Раскрыть** сохраняет команду `explore`. При включённом автообзоре публичный
  фон в этой области выглядит как исследованный. Текущий обзор, свет,
  доступность токенов, объектов и интерактивных проёмов остаются под контролем
  серверной проекции. Если автообзор выключен, раскрытие стирает ручную маску.
- **Сбросить ручной туман** очищает ручные команды и возвращает прозрачную
  основу. Личная и общая память карты сохраняются.
- **Скрыть всю карту** в правой панели редактора заменяет ручную разметку
  сплошной маской. Смена основы поддерживает Undo/Redo.

В правой панели редактора **Автообзор игрока** показывает зоны текущего
обзора, исследованную и неизвестную территорию для выбранного участника.
Ручные правки GM видны отдельными оттенками. GM сохраняет доступ к собственной
карте и объектам, поэтому этот режим показывает зоны, а не интерфейс игрока.

Мазки и сброс проходят через SceneTransaction и SceneHistory. Сервер сверяет
основу и вершину журнала тумана перед Undo/Redo. Обычные изменения идут
дельтами по существующему каналу, восстановление длинного журнала после
отмены сброса запрашивает снимок. Pixi повторно использует текстуру ручного
тумана, а предварительный просмотр остаётся локальным. Раскрытие не
записывает данные в `fog_memories`.
