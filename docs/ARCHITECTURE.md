# Architecture — persistent GM workspace

## Boundaries and routing

One Laravel 13 application serves a Blade entry document and the React/Vite
bundle. There is no second production SPA server, starter-kit replacement,
WebSocket transport or command bus. MySQL is authoritative. File sessions/cache
and synchronous HTTP actions suffice for this stage.

- `/login`, `/register`: custom authentication screens.
- `/`: authenticated compact campaign picker.
- `/campaigns/{campaign}`: GM workspace; opens the first scene when one exists.
- `/campaigns/{campaign}/scenes/{scene}`: explicit GM editing location.
- `/up`: framework health route.

Workspace HTML routes authorize the GM and check the campaign/scene relationship.
API routes authorize independently. Full-document navigation is deliberate: it
releases the old renderer, selection, media requests and save adapter together.
The new shell loads a filtered snapshot into a fresh SceneStore before mounting
the tabletop. Direct links, refresh and browser history work. Navigation does
not activate scenes. Camera is reset to Fit and is not persisted. A later SPA
transition can reuse `SceneStore.hydrate`, but must retain these isolation rules.

## Domain model

| Entity         | Relationships and invariants                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------- |
| User           | Laravel session identity; passwords hashed; explicit safe serialization                            |
| Campaign       | Has scenes and members; optional `active_scene_id`; creator becomes GM                             |
| CampaignMember | Unique `(campaign_id, user_id)`; role `gm` or `player`; multiple GMs supported                     |
| Scene          | Belongs to campaign; name/order, revision, dimensions, explicit square grid and one positioned map |
| Asset          | Campaign, uploader, kind `map`/`token`, safe stored path, MIME, byte size and dimensions           |
| Token          | Scene, optional image and controller; position, size/scale/rotation, vitals, hidden/locked, order  |

There is no universal object JSON blob. Token positions and map placement use
`DECIMAL(...,3)` logical world pixels. Tokens use centers; maps use top-left
coordinates. Size is the unscaled token diameter; rotation is degrees. Grid is
explicitly square. Foreign keys/indexes support membership, scene ordering,
visible token lookup and asset references.

Deleting a scene cascades tokens. Active scene deletion is rejected until it is
deactivated or another scene is activated. Assets remain private and retained.
Attached asset deletion is restricted. User deletion would clear token ownership;
asset uploaders are restricted from deletion. Campaign deletion and physical
asset cleanup have no public operation yet; design their lifecycle before adding
one, especially the active-scene reference cycle.

## Authentication and authorization

The `/api` prefix deliberately uses Laravel's **web** middleware: cookies,
sessions and CSRF, not a stateless API group. `GET /api/session` supplies the
current safe user and CSRF token. Registration/login regenerate the session;
logout invalidates it and regenerates CSRF. Auth attempts and uploads are
throttled. API exceptions are JSON, with no-store responses. Production must
use HTTPS and disable debug responses.

Policies are discovered by Laravel's standard model/policy naming:

| Operation                        | GM                                              | Player                                        | Non-member |
| -------------------------------- | ----------------------------------------------- | --------------------------------------------- | ---------- |
| Campaign read                    | Full preparation list + member choices          | Active scene only, no members                 | Denied     |
| Scene snapshot                   | Any campaign scene, all tokens + editing fields | Active scene only, visible tokens             | Denied     |
| Campaign/scene/admin token write | Allowed                                         | Denied                                        | Denied     |
| Token move                       | Any campaign token                              | Active + owned + visible + unlocked           | Denied     |
| Asset bytes                      | Any campaign asset                              | Only active map or visible active token image | Denied     |

`SceneSnapshotBuilder` owns the explicit projection. Player JSON contains no
hidden entities, ownership metadata, hidden/locked flags, HP/AC/speed, private
paths, or inactive scene metadata. `canMove` exposes only the resulting capability.
The present TypeScript Scene/Token projection is for the GM editor; the future
Player client must use its own reduced type rather than assume HP exists.
Token image relations are eager-loaded, so the snapshot has no per-token queries.

`TokenPolicy::move` is separate from the GM-only administrative patch. Movement
accepts only `x`/`y`; attempted administrative fields do not mutate anything.
All controllers pass validation whitelists, never entire request objects.
Actions recheck authority under the mutation lock. Cross-campaign ownership,
image attachment and scene activation are rejected. Numeric IDs are identifiers,
not credentials; knowing an ID never grants access.

## Private image delivery

The dedicated `campaigns` filesystem disk has `serve=false`, private visibility,
and a root outside `public` and outside Laravel's default servable disk.
`StoreImage` checks header image type, detected MIME, byte size and dimensions;
only PNG/JPEG/WebP are accepted. Client MIME and extension are not trusted. Paths
use generated UUIDs and a detected extension, never the submitted filename.
Failed metadata persistence removes the just-written file.

`GET /api/assets/{id}` authorizes **current usage**, not merely campaign membership,
on every request. Responses use the detected image content type, `nosniff`,
`Cache-Control: private, no-store`, and `Vary: Cookie`. No public URL or physical
storage path is serialized. Reused images are readable if any authorized visible
usage exists. Hiding a token removes access when no other visible use remains.
Previously delivered bytes cannot be revoked from a client that already saw them.

Upload bounds: 16 MiB, 8192 px each side, 32 MP. Proxy/PHP limits are separate;
see README. No image transcoding, thumbnail pipeline, garbage collection or S3
integration is included. The disk boundary permits a later storage adapter.

## HTTP contracts

All paths below have the `/api` prefix. IDs serialize as strings; coordinates
serialize as numbers; booleans are real booleans. Successful mutations return
only explicit fields. Validation errors use Laravel's `errors` field map.

| Method / path                                         | Meaning                                               |
| ----------------------------------------------------- | ----------------------------------------------------- |
| GET `/session`; POST `/register`, `/login`, `/logout` | Session authentication                                |
| GET/POST `/campaigns`; GET/PATCH `/campaigns/{id}`    | Membership-scoped workspaces                          |
| POST `/campaigns/{id}/activate`                       | `{sceneId: string or null}`; independent active scene |
| POST `/campaigns/{id}/scenes`                         | Create, revision 0                                    |
| GET `/scenes/{id}/snapshot`                           | User-filtered hydration                               |
| PATCH/DELETE `/scenes/{id}`                           | Name/dimensions; safe deletion                        |
| PUT `/scenes/{id}/grid`                               | `{size, offset:{x,y}, visible, snap}`                 |
| PUT `/scenes/{id}/map`                                | `{assetId, x,y,width,height}`; null asset removes map |
| POST `/scenes/{id}/tokens`                            | Name and center position; sensible defaults           |
| POST `/tokens/{id}/move`                              | `{x,y}` only                                          |
| PATCH/DELETE `/tokens/{id}`                           | GM-only administrative edit/deletion                  |
| POST `/campaigns/{id}/assets`                         | Multipart `kind` + `file`                             |
| GET `/assets/{id}`                                    | Authorized image bytes                                |

GM snapshot shape:

```text
{id, campaignId, name, revision, width, height,
 grid:{type:'square',size,offset:{x,y},visible,snap},
 map:null | {asset:{id,url,width,height},x,y,width,height},
 tokens:[{id,name,x,y,rotation,scale,size,kind,color,image,canMove,
          hp,maxHp,ac,speed,isHidden,isLocked,ownerUserId}]}
```

The frontend API adapter maps camelCase editing fields to the explicit snake_case
administrative write contract (`max_hp`, `is_hidden`, `owner_user_id`, etc.).
Accepted mutation responses carry `revision` and the canonical changed entity:
`token`, `grid`, `map`, or `deletedId`. They never return an entire scene per drag.
`kind`/`color` currently describe the default placeholder; they are not a rules
system or a full token template schema.

## Transactions and revisions

`SceneTransaction` is the common path for token create/update/move/delete, map,
grid and scene edits. It locks **campaign first, then scene**, validates and writes,
and performs an atomic SQL revision increment in the same transaction. Failed
operations roll back both entity changes and revision. Retryable database
transactions retry up to three times. Canonical decimal values are reloaded before
returning them to the client.

Snapshot reads acquire shared locks in the same campaign → scene order, so the
revision and its entities describe one state and activation cannot change during
projection. Creation, activation and deletion also lock the campaign. New scenes
start at 0; every accepted scene mutation advances once, including accepted
no-op patches. Reading/selecting does not advance it. Standalone uploads and
campaign metadata/activation are not scene mutations; deletion removes the
revision with the scene. A future live activation event needs its own campaign
version/ordering contract.

Revision currently provides ordering, **not** optimistic locking. Concurrent
requests serialize and the last accepted write to a field wins. The four-worker
MySQL check observed 40 unique contiguous revisions for 40 committed moves.
It is not evidence of multiplayer conflict resolution or load capacity.

## Frontend persistence and renderer

```text
HTTP snapshot → SceneStore → React Inspector + Pixi layers
local committed edit → ScenePersistence → SaveQueue → API action
accepted entity + revision → SceneStore.accept → same projections
```

`SceneStore` remains the single client domain projection; React does not keep a
second token/map copy. Selection and sampled drag preview remain separate.
Camera, hover and raw gestures stay renderer-local. The saved domain is
server-authoritative; optimistic client edits are not proof of persistence.

- Pointer move updates Pixi directly, with Inspector samples at most every 80 ms.
- Drop applies the shared cell-center snap calculation and emits one move command.
- Inspector text/numbers commit on blur/Enter; grid saves coalesce for 250 ms.
- `SaveQueue` executes updates serially, preserving order. A failed head blocks
  subsequent writes and displays Save failed without dropping local edits.
- Retry resends the failed command. Reload saved explicitly discards unconfirmed
  local edits. In-app navigation flushes; unload warns while pending/failed.
- Per-entity local version counters prevent earlier accepted responses from
  overwriting later optimistic edits. Scene revision never decreases.
- An in-flight drag preview is reapplied after server acknowledgements, avoiding
  jumps caused by a prior response while the pointer is held.
- Create/delete/upload actions wait for pending edits. They are not automatically
  retried after ambiguous network failures; see next-stage limitations.

`api/client.ts` handles cookies, CSRF and readable failures; `api/workspace.ts`
contains the typed commands. `api/images.ts` fetches private images and decodes
blobs. Tabletop's lifecycle adapter caches decoded media and passes images to
Pixi; no renderer object performs HTTP. Abort controllers ignore superseded
loads. Failed image loads have a recovery state. Texture resources are owned and
destroyed by the renderer on teardown.

Current layer order: viewport background → BattleMapLayer → GridLayer → TokenLayer
→ InteractionLayer. TokenView contains selection/hover rings, optional cropped
image, upright nameplate and HP bar. Hidden GM tokens are dimmed; locked tokens
remain selectable but do not drag. Task 01 vector map/prop classes and demo data
are retained as development/test material, never loaded into a real workspace.

Coordinate math, cursor-anchored zoom, DPR cap 2, pan, selection, snapping, resize
and cancellation behavior remain from Task 01. All layers use one world container.
World is `screen = world * zoom + camera translation`; scene dimensions and
coordinates do not depend on viewport pixels. Resizing cancels a gesture and
preserves world positions. Selection, camera and hover are never sent to the API.

## UX and recovery

The existing dark design tokens, modern typography, Lucide icons, panels and
canvas composition are retained. Auth and campaign picker share that language.
Scenes show Prepared/Editing/Active for players; activation is explicit. Contextual
Inspector actions avoid a CRUD toolbar. Map/scene/campaign empty states are real.
Inspector overlays below 1180 px; library overlays below 900 px; narrow screens
open one at a time. Native dialogs supply focus trapping and confirmation.

The application error boundary and renderer/WebGL recovery overlay remain.
The footer reports saving without success toasts. Permission, upload and backend
validation failures are visible. Browser console HTTP errors are expected only
in deliberately failed QA requests. Full mobile authoring, pinch zoom, docking,
keyboard deletion and undo are deferred.

## Decisions required before realtime

- Add invitations, membership management and a deliberately simpler Player UI.
- Define command IDs/idempotency, expected revision/conflict behavior and accepted
  event envelopes before automatic retries across reconnects. A lost response
  followed by retry may advance revision twice; set operations remain convergent.
- Acknowledge creates reliably; an ambiguous create/upload must be reconciled by
  reload before manually repeating it, to avoid duplicates/orphan images.
- Add snapshot + incremental events with gap detection and reconnect resync;
  filter both snapshots **and broadcasts** per recipient. Never broadcast GM
  serialization onto a shared Player channel.
- Coordinate temporary movement previews with final authoritative moves; don't
  write every pixel or send full scene state. Decide ownership handover and
  in-progress-drag conflicts explicitly.
- Version campaign activation separately and design transition/revocation events.
- Define durable offline pending work, asset cleanup, backup/restore operations,
  multi-GM concurrency and production deployment limits. Current pending work
  lives only in memory and other tabs are not updated automatically.

No Story application coupling, queues/realtime scaffolding, LOS, rules engine,
plugin platform or universal object/event-sourcing framework has been introduced.
