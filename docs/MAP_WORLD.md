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

Campaign → Scene → Open for preparation → Create editable map / Edit map opens the
Map Editor over the existing Pixi viewport. Its settings button opens the foundation
and grid panel. Local settings draft preview uses
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

The material's repeat width is still set in the GM Material Library. With offset
variation enabled, a low-opacity second repeat at a different scale and angle
breaks up a single repeat pattern. Both passes are world-anchored and use the
immutable material version. Source textures should be tileable. Use the base
repeat for surfaces with intentional alignment, such as masonry joints.

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
два клика или drag. В режиме «Правка» GM выбирает вершину, ребро или комнату,
двигает вершину или оба конца ребра, делит ребро пополам и удаляет выбранное.
Удаление комнаты сохраняет её стены. Удаление ребра или вершины удаляет также
полы, у которых разорван контур. Undo возвращает всю топологию и пол.

Привязка независима от сетки токенов. Приоритет получают вершины, затем
проекция на ближайшее ребро, затем узел сетки. Радиус составляет 10 экранных
пикселей с верхней границей в 45% клетки в мировых координатах. Маркеры различают
тип привязки. Завершение стены на ребре делит его и вставляет общую вершину во
все связанные контуры. При перемещении существующей геометрии используется
только привязка к узлам сетки, чтобы drag сохранял связи и ID. Пересечение
осевых линий допускается только в общей вершине. Автоматическое разбиение
произвольных пересечений не выполняется.

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
Player получает видимую геометрию и данные для текстур. Флаги блокировки,
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
стене. После клика «Правка» выбирает новый проём. Перетаскивание по стене
меняет позицию, Inspector меняет ширину и свойства. Для двери доступны
петля, направление, угол, открытие и замок. Для окна доступны деревянная
и металлическая рамы и три независимых флага блокировки. По умолчанию
окно блокирует движение и пропускает обзор и свет.

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

Session использует меню «Двери» для GM. Узкая команда состояния проходит
через существующие ScenePolicy, SceneTransaction, compare-and-set по
хэшу структуры, mutation receipt и structure.updated. Запертая дверь
требует отдельного отпирания перед переключением. Player получает видимую
створку, раму и состояние открытия через snapshot и инкрементальные патчи.
Замок, флаги блокировки и история правок остаются у GM. Хэш Player
вычисляется по видимой проекции. Текущая модель
действий игрока привязана к разрешённым объектам сцены и не выдаёт прав
на структурные проёмы. Игровое взаимодействие Player с дверями и
secret doors отложены до отдельной модели разрешений и проекций.

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
- LOS/Fog/Lighting, NPC AI и MAP-08 не начаты.

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
