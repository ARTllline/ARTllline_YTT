# Architecture — persistent multiplayer tabletop

## Boundaries and routing

One Laravel 13 application serves a Blade entry document and the React/Vite
bundle. MySQL is authoritative. Reverb and Laravel Echo supply the realtime
transport; HTTP Actions remain the only command path. There is no second Node
server, Socket.IO layer or duplicate WebSocket domain implementation. File
sessions/cache and synchronous broadcasts support a single self-hosted instance.

- `/login`, `/register`: custom authentication screens.
- `/`: authenticated compact campaign picker.
- `/campaigns/{campaign}`: GM workspace; opens the first scene when one exists.
- `/campaigns/{campaign}/scenes/{scene}`: explicit GM editing location.
- `/campaigns/{campaign}/play`: member-authorized, minimal Player View.
- `/join/{token}`: public invitation landing; authentication returns here.
- `/broadcasting/auth`: session-authenticated private/presence channel authorization.
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
The rendered Token type permits absent private fields; Player rendering never
assumes HP exists. `SceneStore.role` gates local dragging using `canMove` and
connection state. This affordance is not a replacement for server authorization.
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
revision with the scene. Activation separately increments `campaign.live_revision`,
which identifies the Player subscription epoch even when reactivating the same scene.

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
- Create/delete/upload actions wait for pending edits. Scene command retries reuse
  IDs; the API boundary retains ambiguous one-off commands until confirmation.
  Upload deduplication remains separate future work.

`api/client.ts` handles cookies, CSRF and readable failures; `api/workspace.ts`
contains the typed commands. `api/images.ts` fetches private images and decodes
blobs. Tabletop's lifecycle adapter caches decoded media and passes images to
Pixi; no renderer object performs HTTP. Abort controllers ignore superseded
loads. Failed image loads have a recovery state. Texture resources are owned and
destroyed by the renderer on teardown.

Current layer order: viewport background → BattleMapLayer → GridLayer → TokenLayer
→ FogLayer → SpatialLayer → InteractionLayer. TokenView contains selection/hover rings, optional cropped
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

## Invitations and membership

`CampaignInvite` stores a SHA-256 hash of 32 cryptographically random bytes, creator,
expiry, revocation time, maximum uses and usage count. The raw token is returned
only when creating the URL. Create/list/revoke are GM-only. Join locks the invite
and campaign, validates its state, and inserts only a Player membership. Existing
members keep their role and do not consume another use; exhausted invitations
still accept an existing member. Expired/revoked links do not accept joins.

Routes: GET/POST `/api/campaigns/{id}/invites`, GET `/api/invites/{token}`,
POST `/api/invites/{token}/join`, DELETE `/api/invites/{id}`. Join and creation are
throttled. Auth return targets accept only the local `/join/{64-hex-token}` form.
Member removal and role-management UI are deliberately deferred; revoking an
invitation is not eviction of current players.

## Channels, visibility and event publication

| Echo channel                                                                 | Authorized audience                          | Contents                                                            |
| ---------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| presence `campaign.{campaign}`                                               | Campaign members                             | `{id,name,role}`; no emails                                         |
| private `campaign.{campaign}.control`                                        | Campaign members                             | Activation epoch/active ID; safe membership/scene-list invalidation |
| private `campaign.{campaign}.scene.{scene}.gm`                               | Campaign GMs                                 | Full scene editing events, including prepared scenes                |
| private `campaign.{campaign}.scene.{scene}.epoch.{liveRevision}.user.{user}` | Matching Player, active scene, current epoch | Per-player safe projection and `canMove`                            |

`ChannelAccess` rechecks membership, role, scene/campaign relationship, active
scene, epoch and participant identity at authorization. **Epoch-scoped channels
also protect subscriptions that were already open:** after deactivation no new
prepared-scene edit is published to the old channel. React unsubscribing is not
the security mechanism. Reverb client events/whispers are explicitly disabled.

`ScenePublisher` materializes DTOs while the campaign/scene locks are held, using
the same `SceneSnapshotBuilder` serializers as HTTP. `DB::afterCommit` publishes
`TabletopEvent` (`ShouldBroadcastNow`, wire name `tabletop`) only after the outer
receipt transaction commits. No queue worker or full-scene broadcast is involved.
Origin `X-Socket-ID` is excluded for scene changes/previews; control invalidations
also reach the origin. The socket ID changes delivery only, never authorization.

Persistent scene event envelope:

```json
{
    "type": "token.moved",
    "sceneId": "5",
    "revision": 12,
    "mutationId": "a client command UUID",
    "dragSessionId": "optional drag UUID",
    "payload": { "token": { "id": "4", "x": 750, "y": 510, "canMove": true } }
}
```

The example token is abbreviated; the actual DTO contains the safe visual fields.
Types: `token.created`, `token.updated`, `token.moved`, `token.removed`,
`grid.updated`, `map.updated`, `scene.updated`, `scene.revision`. Hidden → visible
uses `token.created`; visible → hidden sends only `token.removed` + `deletedId`.
Hidden → hidden sends an empty `scene.revision` payload, never an ID, name, image,
owner or vitals. This intentionally exposes revision advancement, not secret
content, so gaps remain meaningful. Inactive scenes publish only to GMs.

Control messages are separate from scene revision: `scene.activated` or
`campaign.changed` carries `{campaignId,liveRevision,activeSceneId}`; clients fetch
the role-filtered campaign projection. No inactive scene names enter this channel.

Transport failure after commit is logged and does not turn accepted HTTP writes
into false save failures. Guzzle has a 1-second connection/2-second total timeout;
after the first transport failure, remaining recipients in that publisher are
skipped. Reconnect and periodic revision probes repair missed publication. This
is not a durable event log or transactional outbox.

## Idempotent HTTP commands

`IdempotentMutation` runs after authentication and before route model binding, so
a repeated DELETE still resolves its receipt after the resource has disappeared.
`IdempotentCommand` atomically reserves `(user_id,client_mutation_id)`, validates a
canonical payload/operation/resource fingerprint and stores the JSON result/status
with the command in one transaction. An identical retry returns the receipt and
does not increment revision or broadcast again. Changed payload/operation with the
same UUID is HTTP 409. Failed authorization/validation leaves no receipt.

Replay rechecks current authorization. A Player cannot reuse a privileged GM
receipt after a role change. Token move replay also checks current ownership,
visibility, lock and activation. Receipt rows deliberately have no resource FK:
delete results must remain replayable. Campaign/user FKs still bound their lifetime.

`ScenePersistence` creates a UUID once per logical queued command; coalesced grid
drafts get the surviving command's ID. Retries reuse it. The API client also keeps
up to 100 ambiguous one-off commands by method/path/payload so retrying a dialog or
Add token after a lost response does not duplicate a committed create. These IDs
are memory-only. Legacy API requests without an ID still work with a server UUID,
but have no cross-request retry guarantee; all current UI scene commands send IDs.
Uploads and campaign creation/rename are outside the scene receipt contract.

## Reconciliation and movement protocol

`useCampaignLive` owns Echo, presence and connection lifecycle. `SceneSubscriber`
owns one scene subscription, buffering, resync and preview transport. The pure
`reduceEvent` function ignores other scenes and revisions <= current, applies
exactly current+1, and requests a snapshot on a gap. Renderer code has no HTTP
or Echo imports. `useSceneLive` connects this lifecycle to the existing store.

Subscribe acknowledgement (including resubscribe) fetches a fresh authoritative
snapshot. Events arriving during that request are buffered. Cleanup aborts the
fetch and ignores late results. Player transitions key the renderer/store by both
scene ID and activation epoch; stale A/B fetches cannot replace C. The previous
canvas, selection and preview state disappear immediately on an activation change.
Camera is independent and local, reset to Fit when entering a new scene.

While local commands are pending, remote persistent changes defer reconciliation;
after successful drain, one snapshot repairs the projection. HTTP revision jumps
also trigger this repair, even if an acknowledgement arrived before the missing
remote event. Ordinary contiguous acknowledgements and own echoes do **not** fetch
a snapshot. Own mutation IDs are bounded/deduplicated in memory. Permission loss
and token removal still cancel Player gestures immediately during pending writes.
Rejected Player moves fetch saved state and retain a readable retry/reload error.
Unsaved GM edits are never silently discarded by reconnect.

Every 15 seconds, a lightweight `/api/scenes/{id}/revision` probe and filtered
campaign refresh repair missed final publications/activation. This is a recovery
mechanism, not the movement transport. Player movement pauses while disconnected,
syncing or after a failed save. Connection and save indicators remain distinct.

Movement has three layers:

1. Local pointer movement updates Pixi immediately; sampled notifications occur
   at most every 80 ms (~12.5 Hz), with at most one preview request in flight.
2. POST `/api/tokens/{id}/preview` validates the same move policy under shared
   campaign/scene locks. Payload: `{x,y,dragSessionId,sequence,baseRevision,cancelled?}`.
   It is rate-limited to 20 requests/second/user, never writes token positions,
   increments revision or creates receipts, and never broadcasts hidden tokens
   to Players. A stale base revision is accepted as an ignored preview.
3. Drop snaps once and sends one persisted move command. The final event carries
   the drag ID. Preview ordering rejects old sequences, completed/cancelled drags,
   other scenes, absent tokens and stale base revisions. Previews expire after
   1.2 seconds; Pixi interpolates toward the preview/canonical position with a
   45 ms time constant, respecting reduced motion. No React render runs per frame.

Final server state always wins. Concurrent authoritative field edits remain last
accepted write wins; there is no drag lease or collaborative field merge. An
unrelated committed scene change invalidates older preview bases conservatively;
the final move still uses normal policy validation rather than optimistic locking.

## Remaining boundaries

No initiative, LOS, audio, cue system, rules engine, Story integration,
generic plugin platform or event-sourcing framework was introduced. Before adding
member eviction/role management, design immediate channel revocation, not merely
HTTP denial. Durable offline work, upload deduplication, asset
cleanup, reverse-proxy production deployment and richer concurrent
editing are future work. Already delivered media cannot be revoked from memory.

## Task 04 — persistent fog and spatial overlays

### Persistent state and transactions

`scenes.fog_base` is `clear` (default) or `covered`. `fog_actions` contains the
scene FK, globally unique ID, scene revision as ordered sequence, operation
`reveal|cover`, shape `brush|rectangle`, world-coordinate JSON geometry, creator
and timestamps. The scene/sequence pair is unique; scene deletion cascades history.
The safe DTO contains only `{id,sequence,operation,shape,geometry}`. Neither creator
nor any scene entity is copied into fog messages. Shared fog is identical for all
Players; GM-only information continues through the existing visibility resolver.

Brush geometry is `{points:[{x,y},...],radius}`; rectangle geometry is two corners.
Validation bounds a stroke to 512 points, radius 5–600 and coordinates -20000–40000.
The UI samples by brush radius and reduces intermediate points on very long strokes;
it never silently splits one pointer gesture into multiple persisted operations.
Rectangles normalize at rendering; the original world corners remain portable.

`POST /api/scenes/{id}/fog/actions` and `/fog/reset` use the existing idempotency
middleware and `FogActions` → `SceneTransaction`. GM authorization is checked before
validation and again under campaign/scene locks. Reset accepts `{base}` and deletes
old actions inside the same transaction. Each accepted command increments revision
once. Idempotent retry returns its receipt without another row, revision or event.
Grid persistence adds `distancePerCell` (0.1–1000) and `distanceUnit` (ft/m/squares);
older clients omitting them preserve the current values.

```text
GM world gesture → local fog draft → pointer up → SceneStore optimistic action
 → ScenePersistence / SaveQueue (one UUID) → authenticated fog action
 → campaign + scene lock → fog row/reset + revision + receipt → commit
 → fog.action / fog.reset → authorized scene channels → revision reducer → FogLayer
```

HTTP returns `fogAction` or compact `fog:{base,actions:[]}`. The reducer appends/reset
only at current+1, ignores old/duplicate events, and requests a snapshot on a gap.
Own acknowledgements replace only the matching temporary action ID, preserving
later optimistic strokes/resets. Failed writes retain visible edits in SaveQueue;
Retry keeps the UUID. No queue coalescing drops fog strokes. Remote changes during
pending local work defer to the existing post-drain snapshot reconciliation.
Inactive scene edits are never sent to Player channels, including old subscriptions.

### GPU composition and lifecycle

`FogLayer` uses two owned Pixi RenderTextures: saved mask and live preview. Maximum
texture side is 2048; world dimensions/geometry remain full precision. Larger worlds
therefore trade edge detail for bounded GPU memory (two RGBA surfaces at most about
32 MiB, excluding driver overhead). At 4096 world px, one mask texel spans 2 px.
Saved history rebuilds only on hydration/reset/resizing or divergent projection;
ordinary appends paint only new actions. Acknowledgement ID changes preserve geometry
references and do not replay history. Preview copies the saved mask then paints the
current draft. Reveal uses erase blending on a Graphics **child** of a paint container;
rendering Graphics itself as the root would discard that inherited blend mode.

Layer order is map → grid → tokens → fog → spatial overlays → interaction markers.
Fog is opaque for Players and 0.48 alpha for GM; tools/pings stay visible above it.
Textures, off-stage Graphics/Sprites and overlay containers are explicitly destroyed.
Resize/teardown cancels gestures; the single PointerController owns all DOM listeners.
`SpatialLayer` caches Graphics/Text per participant, redraws changed geometry and
keeps label sizes constant on screen. Concurrent badges receive vertical collision
avoidance. Expiry destroys the participant's view; reduced-motion mode removes ping
pulsing. Camera changes never alter world geometry or persist anything.

History grows until explicit Cover all / Reveal all. There is no automatic compaction,
bitmap persistence, LOS, token vision, wall model or per-player fog. Future compaction
must preserve ordered erase/cover semantics and avoid turning visual fog into a
security promise. Very long histories still increase snapshot and hydration cost.

### Input and ephemeral transport

`PointerController` dispatches Select/Pan itself and delegates Fog/Ruler/Area/Ping
to `SpatialGesture`. Tool selection lives in `SpatialState`, observable by the compact
React toolbar. Down/move/up/cancel/deactivate run through the same pointer capture;
Space/middle mouse choose temporary Pan before dispatch. Tool changes, Escape,
resize, blur and lost capture cancel drafts. No tool registers another pointer listener.
Player gestures require current connection/movement capability; server authorization
remains independent of this affordance.

```text
world gesture → SpatialState local overlay → sampled/coalesced HTTP command
 → membership + active scene + epoch + geometry validation → server attribution
 → Reverb private channels → SpatialState ordering/TTL → SpatialLayer
```

`POST /api/scenes/{id}/spatial` accepts `{kind,sessionId,startedAt,sequence,phase,
epoch,start,end}`. Kind is ruler/circle/cone/rectangle/ping; phase update/end/cancel.
The server supplies participant ID/name from the session. It uses shared locks to
prevent activation races and rejects inactive scenes, outsiders and stale epochs.
No domain row, receipt or scene revision is written. Cache-based rate limiting is
20 requests/second/user for measurements and 4/second/user for pings, allowing a
quick double ping. No client whispers or arbitrary entity mutation is accepted.

All recipients of spatial and movement-preview messages have identical safe payloads,
so one Reverb publication targets the explicit authorized channel list. Persistent
token messages still use recipient-specific projections (`canMove`, GM fields).
The controller/ScenePublisher, not the client, decides the channel list.

`SceneSubscriber` coalesces at 80 ms and allows one spatial request in flight;
terminal updates survive normal backpressure. It drops pending sends after loss of
connection/activation. Received events must match scene and epoch. `SpatialState`
orders by per-participant gesture start time and per-session sequence, rejects
late/duplicate/terminal updates, keeps one overlay per participant, and bounds order
tracking to 256 participants. Session start times are monotonic within the client.
Multiple tabs of one user intentionally share one participant slot; clock skew across
those tabs remains a limitation, not an authoritative scene-state conflict.

A held stationary gesture renews once per second.
Unfinished overlays expire after 1.8 s without updates; finished ruler/AoE after 5 s;
pings after 2.2 s. Cancel removes immediately when delivered. Disconnect/scene change
clears all projections; reconnect restores persistent fog only. Ephemeral loss is
repaired by expiry/new gestures, never replay. No offline queue stores overlays.

### Geometry and future combat boundary

Pure helpers implement Euclidean distance, `(pixels/grid.size)*distancePerCell`,
cell-center snap with offsets, rectangle normalization, radius, cone direction,
length and a fixed 60-degree aperture. Labels round to one decimal. Grid changes
recompute labels; zoom only changes presentation. These helpers can support future
combat measurements without importing a rules engine or embedding spell definitions
inside the renderer. Persistent templates and movement-cost rules are separate future
work, as are hex grids, individual vision, automated fog compaction and durable undo.

### Receipt lifecycle

`tabletop:prune-receipts` deletes completed rows older than configured days, minimum
one/default seven, using indexed `created_at`. Dry run only counts. The daily Laravel
scheduler entry has overlap protection; operators must run the scheduler. Receipt
retention bounds retry guarantees, not campaign history. In-memory browser queues
must be reconciled before retry after the retention window. No receipt archive or
background queue infrastructure was introduced.
