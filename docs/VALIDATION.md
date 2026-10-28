# Task 05 validation

Validated locally on 2026-10-28 against Task 04 commit `5bb1d8f`. Laravel 13.39,
PHP 8.3.32, MySQL 8, Reverb 1.12.0, Node 20.20.2 and Chromium. The additive combat
migration was applied to local YTT. AGENTS, dependency lockfiles, application key,
system PHP configuration and production systems were not changed.

## Automated checks

| Command                        | Result                                     |
| ------------------------------ | ------------------------------------------ |
| `composer test`                | **38 tests / 440 assertions passed**       |
| `npm run test`                 | **52 tests passed**                        |
| `npm run typecheck`            | Passed                                     |
| `npm run lint`                 | Passed                                     |
| `npm run build`                | Passed; Pixi remains a separate lazy chunk |
| `php vendor/bin/pint --test`   | Passed                                     |
| `composer validate`            | Passed                                     |
| `composer check-platform-reqs` | Passed                                     |
| `git diff --check`             | Passed                                     |

Six new PHP feature tests use isolated SQLite and after-commit event fakes. They
exercise lifecycle/round wrapping/jump/end history; preparation sorting/nulls/ties,
manual order and active-order stability; empty and duplicate participation; stale
turn conflict and exact-once retry; hidden current/reveal/hide and composite deletion;
HP delta replay/clamping/max reduction/ownership transfer; condition normalization,
visibility/remove replay and old movement-receipt filtering; all GM-only command
boundaries and cross-scene rejection. Previous tests were updated only where the
Task 05 contract intentionally changes: owner HP is now visible and hide can carry
a nullable combat projection.

Six new client cases cover hydration/replacement/current-ring mapping, coherent
delete+combat reducer behavior, duplicate/gap handling, removal of former-owner HP,
terminal conflict recovery with a retained explanation, and same-UUID lost-response
retry for both HP and Next. Server tests own the authoritative sorting/round rules;
there is no duplicated client rules implementation to test.

## Real MySQL concurrency — finding and correction

The ignored guarded script `artifacts/task05-check.php` creates only explicitly
marked QA05 fixtures in campaign **QA05 · The Last Watch**. Four independent PHP
processes execute five `IdempotentCommand` + `TokenCombatActions` deltas each and replay
every UUID. This bypasses the single-worker HTTP server, so database concurrency is
real. A second pair executes Next with the same expected turn and distinct UUIDs.

The first runs exposed two issues that sequential SQLite/HTTP tests could not:

- Receipt insertion took a shared campaign FK lock before SceneTransaction requested
  its writer lock, producing lock-upgrade deadlocks under concurrent commands.
- Moving the writer lock earlier while retaining a nonlocking read inside the outer
  transaction still pinned MySQL REPEATABLE READ to an older snapshot: HP deltas could
  overwrite each other, and both turn commands could accept the old current state.

The final fix resolves routing before opening the outer transaction and makes the
campaign writer lock its first transactional query, before receipt insertion. It
preserves the campaign → scene authority order and the existing receipt semantics;
no global isolation setting was changed.

**Final result:** 20 accepted damage commands, 20 harmless retries, HP **30 → 10**,
unique contiguous revisions **4–23**. Two concurrent Next commands produced **200
and 409**, with one additional revision **24**. No deadlock or lost delta remained
in this run. This is a correctness burst, not an unbounded contention guarantee.
Failed preliminary QA scenes were deleted only after checking their campaign/name;
this also exercised real MySQL scene/combat/condition cascade deletion. Final
concurrency fixture remains for inspection; no application seed data was introduced.

## Real GM / Player combat acceptance

Separate Chromium cookie contexts used real MySQL, HTTP and Reverb. The main fixture
is **The Lantern Ambush** (scene 10) in **QA05 · The Last Watch**, with **Prepared
Courtyard** (scene 11). Campaign, members, four initial tokens and a map were created
through authorized HTTP/UI flows. The original generated QA map was copied through
private upload; no external asset was fetched.

1. GM prepared combat, used the searchable picker to add all four tokens at once,
   entered initiatives 15/12/12/8 with Enter, then dragged Goblin Archer ahead of Mira
   in their tie. Player saw no preparing tracker. Begin automatically displayed
   round 1, visible order and Your Turn for Rowan; hidden Dragon was absent.
2. Four Next clicks wrapped to round 2. Previous returned to the last participant in
   round 1 and Player displayed **GM Turn**. Make current jumped to Mira. The tracker
   and canvas current ring followed authoritative state.
3. Damage -7 changed Rowan **30 → 23** in both views. NPC damage produced no exact NPC
   HP in Player snapshots or captured WebSocket DTOs. Public Poisoned appeared;
   GM-only Secret Mark was absent from both network and UI. Later public/private
   toggles updated Player live; Heal restored **22 → 27** through the UI.
4. A committed Damage -5 response was aborted. Save failed retained the command;
   Retry reused its UUID and HP stayed **18**, revision **28 → 28** on retry. A
   committed Next response was aborted separately; Retry kept the same current turn
   and revision **29 → 29**. No double application in either case.
5. Hidden Dragon became current with no identity in Player's event. Reveal emitted
   token+combat together at **r30**, restoring the participant without reload.
   Deleting that current Token through the confirmation dialog emitted one coherent
   removal+corrected-combat envelope at **r31**. Both trackers had three entries;
   current became Rowan, with no second same-revision event.
6. A second independent GM context received an initiative edit. A barrier released
   both Next requests with the same expected state and different UUIDs: **200/409**,
   scene **r32 → r33**, same final current in both windows. Self-review fixed the
   conflict explanation being cleared by a following subscriber resync; a client
   regression test protects its persistence. A final browser race injection confirmed
   that the explanation remains visible after resync and clears on the next command.
7. Reload restored order/current/HP/conditions. The verified local Reverb process was
   stopped; Player visibly showed **Reconnecting…**. GM advanced the turn, healed and
   added Concentrating while disconnected (**r33 → r36**). After restarting Reverb,
   Player actually received snapshot **r36**, correct current, **22 HP**, Poisoned
   and Concentrating without page reload. An initial automation attempt waited for
   the wrong exact status text and was repeated; it is not counted as acceptance.
8. Activating Prepared Courtyard cleared old combat/indicators and did not expose
   its preparing combat. Returning restored active combat. End used confirmation,
   removed the Player tracker and retained token HP/conditions and ended history.
9. A later active-combat Player drag moved Rowan **(330,450) → (450,450)** and advanced
   exactly **r43 → r44**, after using fog/ruler/area/ping in the stress scene.
10. A temporary Player WebSocket proxy dropped exactly one combat event. The next HP
    event caused **one repair snapshot**, restoring both current and **26 HP at r46**.
    The temporary context was then closed, so interception does not affect normal play.

Normal interaction and load produced no JavaScript page exceptions. Browser network
errors during aborted responses, deliberate 409s and broker outages are expected.
Snapshots/events were inspected as JSON, not inferred only from hidden UI controls.
HTTP and Reverb were left running; no production deployment occurred.

## Six-participant sanity test

**1 GM + 5 independently authenticated Players**, six real Reverb connections.
The marked stress fixture has an actual **4096×3072 PNG**, a world of the same size,
**30 tokens, 205 fog actions, 15 combatants**, and public conditions on the combatants.
The guarded local QA script generated this synthetic scene; gameplay commands in
this test went through authenticated HTTP and normal publication.

Four rounds sent **32 persistent commands**: 20 concurrent Player movements, four
Next commands, four HP deltas and four condition additions. Every client received
all **32 events**: **192/192 deliveries**. All six snapshots agreed on **r240**.
Each Player received numeric HP for exactly its one owned token. No HTTP failure or
JavaScript exception occurred. This run exercised final movement, not saturation
at the preview rate limit.

Elapsed workload/collection time: **4.90 s**. Request-start → matching WebSocket
frame latency over 192 samples: **p50 113 ms / p95 787 ms / max 993 ms**. CSRF sessions
were fetched before timing; commands had distinct UUIDs. PHP used the same
process-local OPcache setup from Task 04. Persistent personal DTOs still publish per
recipient. This is a Windows single-worker local burst, not a WAN/VPS/Redis or
8-player capacity claim; p95 was higher than the Task 04 ephemeral batching workload.

## Renderer, lifecycle and visual checks

On the stress scene, a real fog brush appended one action **205 → 206**, revision
**240 → 241**. Ruler, area and ping gestures produced overlays without extra scene
revisions. Four simultaneous remote ruler/circle/cone/rectangle overlays were shown
with combat active while Space-pan and wheel zoom operated. Canvas count stayed one.

A 180-frame sample during pan/zoom/overlays and screenshot capture measured
**p50 8.3 ms / p95 8.4 ms / max 58.2 ms**. A later steady sample without screenshot
capture measured **8.3 / 8.4 / 8.5 ms**. The outlier is retained; these browser frame
intervals are not a GPU profiler or proof of all-device performance.

Ten scene transitions initially measured DOM nodes **455 → 458**, listeners
**212 → 225**, heap **8.88 → 10.28 MB** with explicit GC and one canvas. Because the
initial sample could overlap renderer setup, a further six transitions were checked
after settling: nodes **453 → 453**, listeners **225 → 225**, heap **10.47 → 10.88 MB**,
one canvas. No continuing DOM/listener accumulation was observed; heap growth and
long-session GPU behavior still require a soak test. New TokenView resources are
owned children destroyed with their token. Fog's 2048 mask cap/history limits remain.

Inspected desktop GM/Player screenshots, current rings, compact condition chips,
manual reorder feedback, hidden-turn state and collapsed Player tracker. Player
widths **1440, 1024 (reported CSS 1025), 768, 390** had no horizontal document overflow
and one canvas. A 15-entry tracker scrolls within a bounded panel; collapse preserves
map space. Native dialogs, labeled buttons, focus styles and keyboard reorder remain.
Local ignored evidence includes `artifacts/task05-gm-combat.png`,
`task05-player-combat.png`, `task05-stress-spatial.png`, `task05-player-{width}.png`,
and `task05-player-390-collapsed.png`.
Final working views are `task05-final-gm.png` and `task05-final-player.png`.

## Repeat and deferred boundaries

Follow README's normal startup, migrate and build. In separate browser profiles:
prepare → batch add → initiative → drag tie → begin → wrap/previous/jump → damage/heal
→ public/private conditions → hide/reveal → delete current → end. Inspect Player
JSON and frames, then abort committed damage/Next responses and Retry. Test two GM
windows with the same expected turn. Stop/restart the verified Reverb process and
confirm a fresh snapshot; deliberately omit one combat event to exercise gap repair.
Use a dedicated QA scene for parallel MySQL actions and load fixtures, never real
campaigns. Tests do not run migrations against the working MySQL database.

No dice, attack/save adjudication, spell automation, temporary HP, death saves,
condition durations, encounter library, combat-history UI or automated turns were
added. History currently retains combat metadata/references, not immutable token
identity. Richer HP sharing is a future policy decision. Conditions cap at 30 with
three canvas badges; larger scales need UX/performance review. Fog compaction, GPU
soak testing, durable offline queues, touch/Safari/Firefox and production hosting
remain deferred. Earlier sections below are historical evidence only.

---

# Task 04 validation

Validated locally on 2026-10-28 against committed Task 03 (`cba8b48`). Laravel 13.39,
PHP 8.3.32, MySQL 8, Reverb 1.12.0, Node 20.20.2 and Chromium. `AGENTS.md` is unchanged.
The two additive migrations were applied to the local YTT database. No production
rollout, system PHP configuration change or unrelated database modification occurred.

## Automated checks

| Command                        | Result                               |
| ------------------------------ | ------------------------------------ |
| `composer test`                | **32 tests / 300 assertions passed** |
| `npm run test`                 | **46 tests passed**                  |
| `npm run typecheck`            | Passed                               |
| `npm run lint`                 | Passed                               |
| `npm run build`                | Passed; Pixi remains lazy-loaded     |
| `php vendor/bin/pint --test`   | Passed                               |
| `composer validate`            | Passed                               |
| `composer check-platform-reqs` | Passed                               |
| `git diff --check`             | Passed                               |

New PHP tests use isolated SQLite with after-commit event fakes. They verify GM-only
fog, Player/outsider denials, exact-once receipt replay, ordered persisted geometry,
compact reset, filtered snapshots/events, no inactive Player publication, geometry
limits, unit persistence, authenticated attribution, epoch checks, ping throttling,
no domain writes for ephemeral tools, authorized multi-channel publication and receipt
prune/dry-run retention. Prior authentication/private-assets/movement tests remain.

New client tests cover Euclidean/world distance and unit labels, circle radius,
cone aperture/direction/length, normalized rectangles, negative/offset cell-center
snap, duplicate/out-of-order/terminal ephemeral events, expiry/cancellation, local-only
prepared tools, fog reducer resets/gaps, pending stroke/reset ordering with the same
UUID on retry, scene epoch rejection and subscriber-disposal cleanup.

## Real GM / Player acceptance

Separate Chromium contexts/cookies used the real HTTP server, MySQL and Reverb.
The dedicated fixture is **QA04 · Mist & Distance**, with **Mistwater Crossing**
and **Prepared Watchtower**. An existing QA GM and Player joined through a new
invitation; four additional explicitly named QA04 accounts were registered and
joined through the API. No application demo seed was introduced.

- Cover all used the confirmation dialog. Player saw an opaque dark cover; GM
  retained a reduced-opacity view. A Pixi blend-root issue found visually was fixed
  before acceptance: the brush now renders as a child of the paint container.
- A real brush drag kept revision **34 while held**, then saved once. A rectangle
  reveal advanced it to **36**. Captured Player frames contained two `fog.action`
  messages and no secret token text. Player snapshot omitted QA04_SECRET_DRAGON.
- Cover brush and cover rectangle restored concealment. Player reload returned
  exactly the same saved fog. Reset compaction/idempotency is also covered in PHP.
- Both GM → Player and Player → GM rulers displayed **30 ft** for 360 world pixels
  at grid 60 / 5 ft. Captured coordinates were `(630,570)` → `(990,570)`; camera sizes
  differed. Scene revision remained **37** across measurements. Pan/zoom retained
  geometry while screen-space labels stayed readable. A final 2.5-second stationary
  hold produced four update samples and one end, keeping the remote ruler visible.
- Circle, 60° cone and rectangle were dragged from both contexts. Captured update/end
  kinds matched the chosen shape. Inspected circle/cone/rectangle screenshots.
  Simultaneous overlays use different local/remote color treatment and label
  collision avoidance. No combat/spell/movement-rule interpretation was added.
- Pings were delivered in both directions, including quick repeated clicks, then
  expired. They did not move cameras or change scene revisions. Spam rejection is
  covered by the real rate limiter in the PHP test (first four accepted, fifth 429).
- A committed cover rectangle's HTTP response was deliberately aborted. Save failed
  retained the local projection; Retry reused UUID `01353c35-6cc1-43e4-bca7-a82c01cc5d6e`.
  Revision was **263 → 264 → 264**, with one added action, not two.
- The verified local Reverb process was stopped. GM fog painting still saved. On a
  repeated instrumented outage, the Player showed Reconnecting and a GM command
  advanced **265 → 266**. After restarting Reverb, the Player actually received a
  fresh snapshot **r266 / 225 actions**, without reloading its tab.
- Activating Prepared Watchtower cleared prior overlays/canvas state. GM continued
  editing Crossing; the Player received **zero old-scene events**, and Watchtower's
  clear fog/revision were unchanged. GM ruler in the prepared scene stayed local.
  Returning to Crossing restored its saved fog.
- Fog + Space pan and Ruler + Space pan caused no writes. Escape during an area
  gesture cancelled it and selected Select. A real Player token drag moved Rowan
  `(330,330)` → `(450,450)` with revision **266 → 267**, after spatial tools had been
  used. A ping followed by wheel zoom and immediate activation also transitioned
  cleanly to the new scene. UI shortcut fields and contextual toolbar selection
  were checked. Wheel zoom remained independent of overlays.

Expected browser network errors occurred only for deliberate broker outages and the
aborted HTTP response. Normal interaction and the six-client load run produced no
JavaScript page exceptions. No public or third-party data was sent anywhere.

## Renderer, visual and lifecycle checks

A generated original PNG **4096 × 3072** was uploaded through the actual map input,
rendered in a world of the same size with **30 tokens**, **224 saved fog actions**,
four simultaneous ruler/AoE overlays and pan/zoom. A 180-frame requestAnimationFrame
sample measured **p50 8.3 ms / p95 8.4 ms / max 8.5 ms** in that local browser run.
An earlier scaled-map pass measured max 25 ms. These are browser frame intervals,
not GPU profiler results or guarantees for every device.

Fog uses two surfaces capped at 2048 per side; its raw RGBA surface allocation is
bounded around 32 MiB. Saved appends do not replay old geometry; acknowledgements
replace IDs without changing geometry references. No full-scene JSON is sent per
spatial gesture. Source review checked explicit owned-texture/Graphics destruction.

Ten active-scene transitions with an explicit GC sample kept **one canvas**, DOM
nodes **122 → 122**, and event listeners **196 → 196**. JS heap was approximately
**8.36 → 9.42 MB**; this short run does not prove zero heap/GPU growth over hours.
No page exceptions occurred. The Player's old store/subscriber/render tree is disposed
by scene/epoch key, and late scene fetches/events are guarded by existing tests.

Visual inspection covered opaque Player fog, GM x-ray treatment, brush/rectangle
edges, ruler badges, translucent shapes, ping pulse/fade and compact tool settings.
Player widths **1440, 1024 (reported CSS innerWidth 1025), 768 and 390** retained one
canvas with no horizontal document overflow. The narrow player overlay remains usable.
GM was checked at 1440 with the existing dense workspace; Task 03's broader shell
breakpoint record remains historical, not a new all-breakpoint claim.

Local ignored evidence includes `artifacts/task04-fog-fixed.png`,
`task04-gm-tools.png`, `task04-ruler-both.png`, `task04-verified-cone.png`,
`task04-verified-rectangle.png`, `task04-ping-debug.png`, `task04-ping-expired.png`,
`task04-large-final.png`, and `task04-player-{1024,768,390}.png`.

## Practical multiplayer load check

**One GM + five independently authenticated Player contexts**, six real Reverb
connections, 30 tokens and 203–221 fog-history actions. Six rounds sent **81 HTTP
commands**: 30 spatial measurements, 30 authorized token movement previews, 15 pings
and six persistent fog mutations. HTTP commands were issued concurrently between
players; within each player the calls respected completion/backpressure. This is a
practical burst check, not a sustained 20 Hz/user saturation benchmark.

Every client received **45 spatial events + 30 previews + 6 fog events**: **486
expected deliveries**, no missing or duplicate-count discrepancies. All six final
snapshots agreed on **r261**, with no HTTP failures or JS exceptions. Latency samples
matched the spatial session/sequence or persistent mutation UUID from request start
to received WebSocket frame; the 306 samples exclude move-preview latency.

| Local configuration                                                   | Run time  | p50 delivery | p95 delivery | Max        |
| --------------------------------------------------------------------- | --------- | ------------ | ------------ | ---------- |
| PHP built-in server, no OPcache, original per-recipient preview sends | 34.7 s    | 1016 ms      | 2333 ms      | 2588 ms    |
| Same uncached server, batched safe preview publication                | 53.5 s    | 1006 ms      | 16652 ms     | 17488 ms   |
| Process-local OPcache enabled, batched preview publication            | **6.8 s** | **165 ms**   | **361 ms**   | **368 ms** |

The slow second run is retained rather than discarded. Batching alone did not fix
this environment's latency. Baseline session reads were about 180–220 ms each
before OPcache; serialized PHP request/bootstrap overhead is a strong contributing
factor. This does not establish a complete cause for the 17-second outlier.
OPcache was enabled with per-process flags and timestamp validation; no system
`php.ini`, existing application key or credentials were changed.

Across the earlier load interval, Reverb CPU time increased **1.734 → 2.109 s**
and working set remained about **31.3 MB** (private memory ~40 MB). After the warm
OPcache run, cumulative CPU was **2.297 s**, working set **31.318 MB** and private
memory **39.985 MB**. These process samples span setup/idle time as well as commands;
they are not peak CPU utilization or an isolated throughput profile. Reverb remained
stable. Preview requests are intentionally expendable under backpressure; final
persistent events and authoritative resync remain the correctness mechanism.

Use PHP-FPM/another appropriate multi-worker web setup with OPcache for a hosted
session. This Windows single-worker development test is not a VPS/WAN benchmark,
production reverse-proxy test, Redis scaling test or 8-player capacity guarantee.
README's proxy guidance was checked against the official Reverb 13 documentation;
no proxy was deployed. The local HTTP and Reverb services were left running.

## Repeat and remaining boundaries

1. Follow README, migrate, build, start HTTP + Reverb; run the scheduler if unattended
   receipt cleanup is desired. Check `tabletop:prune-receipts --dry-run` first.
2. Use independent profiles for GM/Player; invite, activate, assign tokens.
3. Cover all, reveal brush/rectangle, cover again, reload Player and compare snapshots.
4. Drag ruler and each area both ways, change camera, cancel and let overlays expire.
5. Abort a committed fog response, Retry, verify same UUID/one revision.
6. Stop Reverb, paint fog, restart, observe resubscription snapshot and correct fog.
7. Edit an inactive scene and change active scenes repeatedly; watch private frames,
   canvas count, browser errors and resource counters.
8. For load, use 4–8 Player contexts, hundreds of fog actions, concurrent overlays,
   previews/pings and persistent events; record delivery counts and timestamps.

History compaction beyond an explicit full reset, long-session GPU profiling,
physical touch devices, Safari/Firefox, individual visibility/LOS, initiative/combat,
persistent templates, hex grids, audio, asset-library expansion, handouts, encounters,
prefabs, cues/triggers, camera direction and Story integration remain deferred.
Prepared work still uses the existing memory-only retry queue, not durable offline
storage. Fog conceals pixels only; **Hidden** remains the secret-information boundary.

---

# Task 03 validation — historical baseline

Validated locally on 2026-10-28 with PHP 8.3.32, Node 20.20.2, Laravel 13.39,
Reverb 1.12.0, Echo 2.6.3, MySQL 8 and Chromium. Task 02's committed baseline
was preserved and extended. `AGENTS.md` is unchanged. No production deployment
or unrelated database was modified.

## Current automated checks

| Command                                      | Result                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `composer test`                              | **27 tests / 242 assertions passed**, including all Task 02 tests       |
| `npm test`                                   | **38 tests passed**, including prior coordinate/store/persistence tests |
| `npm run typecheck` / build's `tsc --noEmit` | Passed                                                                  |
| `npm run lint`                               | Passed                                                                  |
| `npm run build`                              | Passed; Pixi renderer remains a lazy chunk                              |
| `php vendor/bin/pint --test`                 | Passed                                                                  |
| `composer validate`                          | Valid manifest and lockfile                                             |
| `composer check-platform-reqs`               | All installed requirements satisfied                                    |
| `git diff --check`                           | No whitespace errors                                                    |

PHP tests use isolated SQLite, not the configured MySQL campaign database. New
broadcast tests use `DatabaseMigrations` so after-commit publication is exercised;
event fakes capture materialized recipient-safe messages. Coverage includes:

- Invite hashing, expiry, revocation, max uses, idempotent existing membership,
  guest denial and refusal to promote a submitted `role=gm`.
- Actual `/broadcasting/auth` responses for GM, Player and outsider; private
  channel identity/role/activation epoch checks; presence contains no email.
- Hidden → visible create, visible → hidden removal, secret edit no-op revisions,
  deletion, and no Player messages from inactive prepared scenes.
- Receipt replay: same response, one revision and one publication; conflicting
  payload 409; deletion replay after model deletion; create replay without a
  duplicate; replay denied after permission or privileged-role changes.
- Preview performs no token write, revision increment or receipt insertion.
  Ownership, lock, hidden and inactive checks match final movement; previews
  based on the pre-final revision are ignored after commit.
- Failed authorization/validation rolls back the receipt and emits nothing.
  The transport failure boundary does not throw after a commit notification.

New client tests exercise gap detection, duplicate/old/other-scene events,
selection reconciliation, capability changes, preview ordering/final precedence,
stable retry IDs, ambiguous create retry, rejected Player move rollback, snapshot
on resubscribe, buffering during concurrent local writes, late/disposed fetches,
slow snapshots racing accepted writes and recovery after an HTTP probe failure
without any scene revision change. Normal own movement/echo does not refetch a
whole scene.

## Real two-context multiplayer acceptance

Chromium used **independent GM and Player browser contexts** (separate cookies),
the production bundle, real Laravel/Reverb and real MySQL at `127.0.0.1`.
A second GM tab was also exercised. The dedicated QA campaign is
**QA03 · The Lantern Coast**, with **Lantern Crossing** and **The Quiet Harbor**.
Fixtures were created through authorized HTTP/UI flows, not seeded production rows.

1. GM created an invitation in the Players dialog. The new Player followed it,
   registered, returned to the invitation, joined and opened `/campaigns/{id}/play`.
   A separate max-one-use invitation joined the dedicated acceptance campaign.
   GM presence displayed both users Online with no email fields.
   A final browser pass also copied an invitation successfully, revoked it through
   the dialog and verified that its landing page reported the revoked state.
2. With no active scene the Player saw the waiting screen. Clicking Activate in
   the GM workspace automatically opened the active scene without a Player reload.
3. Player snapshot contained only two visible tokens, with `canMove=true` only
   for the assigned token. HP/AC/owner/hidden flags and the secret token were absent.
4. A real Player mouse drag moved its token from `(630,510)` to `(750,630)` and
   advanced the stored scene revision by **exactly one**. Temporary preview
   requests carried drag UUID/sequence/base revision; one final HTTP move carried
   a stable mutation UUID. The origin received no own scene echo.
5. A real GM mouse drag delivered **14 preview events before drop** to the Player.
   A database-backed snapshot taken while the mouse was held still had revision
   11; releasing produced revision 12 and the canonical `(750,510)` position.
   No full scene was sent in preview/final commands or broadcast payloads.
6. Hide/reveal used the actual Inspector checkbox. Player received removal and
   then safe creation; the hidden snapshot omitted the token. Editing a different
   always-hidden token produced only an empty revision event. Captured Player
   WebSocket frames contained no secret token name, HP, owner or image metadata.
7. Locking the assigned token during a Player drag cancelled the gesture. The
   final saved position stayed `(870,630)` and the Player showed view-only state.
8. A second GM tab edited The Quiet Harbor while Player stayed in Lantern Crossing.
   Activating Harbor moved the Player and updated the first GM's active indicator;
   that GM's editing scene remained Crossing. Inactive Crossing edits produced
   **zero** old-scene Player events and no inactive secret text in captured frames.
9. Rapid A → B → C activation was tested with B's snapshot artificially delayed
   by one second. C remained **Beacon Hold** after the delayed B response completed;
   there was one canvas. The temporary C fixture was removed after returning to A.
10. Playwright's WebSocket proxy deliberately dropped one persistent event, then
    delivered the next revision. Player fetched **one** repair snapshot containing
    both changes. Duplicate same-revision events with a deliberately corrupted
    token name were ignored; the selected label remained canonical.
11. Playwright allowed a token creation to commit and then aborted its HTTP
    response. Clicking Add token again reused the **same UUID**: token count and
    revision each advanced once, not twice. The temporary test token was deleted.
12. The verified local Reverb process was stopped. Player showed **Reconnecting**.
    A GM HTTP move succeeded while the broker was down (revision **19 → 20**).
    After Reverb restarted, both clients recovered without reload; GM showed r20,
    and clicking the Player token at its new `(870,630)` position selected Rowan.
    HTTP request failure / WebSocket connection errors in this fault-injection
    phase are expected; normal interaction produced no JavaScript page errors.

A final **Vite / React StrictMode** pass ran the documented three processes.
Changing a token name through the GM Inspector updated the selected Player label;
both contexts retained exactly one canvas and no JavaScript page errors. The
temporary Vite process was then stopped and the app returned to the built bundle.
StrictMode's deliberate first-effect teardown produced one expected Pusher
warning about closing a socket before its handshake completed; no duplicate
active subscription, canvas or application exception remained.

## Visual checks

Inspected screenshots of the GM workspace, Players/invitation dialog, full Player
tabletop and narrow Player layout. The existing restrained dark shell is retained;
the Player has only the scene title, connection state, contextual token hint and
pan/zoom/fit controls. Owned tokens have a small pale marker/ring. No GM Inspector,
scene preparation list, vitals or invitation controls appear in Player View.

GM widths **1440 / 1366 / 1024** and Player widths **1440 / 1024 / 768 / 390**
had no document horizontal overflow and exactly one canvas. Resizing preserves
the local camera; Fit restores the whole scene. Evidence is local/ignored:

- `artifacts/task03-gm-desktop.png`
- `artifacts/task03-player-desktop.png`
- `artifacts/task03-player-768.png`
- `artifacts/task03-player-390.png`
- `artifacts/task03-players-panel.png`
- `artifacts/task03-player-waiting.png`

## Repeat and limitations

Follow README's three-process startup. Use distinct browser profiles for GM and
Player; tabs sharing cookies do not represent different users. Repeat invite →
waiting → activate → assign → drag → hide/reveal → change active scene, then stop
and restart Reverb while making an HTTP edit. Unit tests cover controlled ordering
and race cases; browser validation above additionally injected actual transport
loss and duplicates. Re-run visual checks after changing chrome or renderer input.

This is not a 4–8-player load benchmark, WAN latency study, Safari/Firefox run,
physical touch-device test or production reverse-proxy deployment. File cache and
single-process local PHP were used; Redis scaling was not exercised. Preview
delivery may fall below its 12.5 Hz ceiling under HTTP backpressure. Pending edits
and retry IDs are memory-only; forced close does not preserve unsaved work.
Receipts currently have no automatic retention cleanup. Upload deduplication,
membership eviction/role-management UI, durable event delivery, fog, initiative,
audio and cues remain deferred. Field conflicts use last accepted write wins.

---

# Task 02 validation — historical baseline

The following records the prior stage. Its explicit limitations describe Task 02
only; current multiplayer behavior and results are documented above.

Validated locally on 2026-10-28 with PHP 8.3.32, Node 20.20.2, Laravel 13.39,
MySQL 8 and the installed lockfiles. `AGENTS.md` was preserved unchanged.

## Automated checks

| Command                        | Result                                                               |
| ------------------------------ | -------------------------------------------------------------------- |
| `composer test`                | 15 tests, 144 assertions passed                                      |
| `npm run test`                 | 22 tests passed, including all 15 Task 01 math/store tests           |
| `npm run typecheck`            | Strict TypeScript passed                                             |
| `npm run lint`                 | ESLint/TypeScript/React Hooks passed                                 |
| `npm run build`                | Production Vite build passed; renderer remains a separate lazy chunk |
| `php vendor/bin/pint --test`   | Passed                                                               |
| `composer validate`            | Valid package definition and lockfile                                |
| `composer check-platform-reqs` | Installed backend platform requirements satisfied                    |

Feature tests use `RefreshDatabase`, SQLite in memory and fake private storage.
They do not migrate/reset the real working MySQL database. Coverage includes:

- Registration, hashed passwords, current user, login failure/success, logout,
  guest access and a real CSRF middleware rejection (testing bypass disabled).
- Creator GM membership, unique membership constraint, additional GM access,
  Player read-only campaign scope and unrelated-user denial.
- Scene creation, activation independent of editing, active-scene deletion
  rejection, token cascade deletion and cross-campaign URL/activation rejection.
- Player snapshot omits hidden entities entirely, inactive scenes and GM fields;
  GM sees required editing metadata and hidden tokens.
- Player move requires active + owned + visible + unlocked; common administrative
  PATCH is denied and extra admin fields in move cannot change those values.
- GM can move hidden/locked tokens through the authorized action; foreign owner
  and token-image assignments are rejected.
- Every successful scene command increments revision, failures do not, and
  persisted map/grid/token fields round-trip through a new snapshot.
- Private asset access follows current visible usage, including revocation after
  hiding; prepared inactive maps and unrelated users are denied.
- PNG/JPEG/WebP acceptance; spoofed MIME, SVG, excess dimensions/bytes rejected;
  adversarial client filename/extension never controls the generated storage path.

Frontend tests cover immutable scene math/state, hydration replacing prior
selection/preview, zero writes for previews and one committed move, grid
coalescing/flush, serial failure/retry, stale acknowledgement suppression, the
explicit Inspector-to-wire field contract, CSRF headers and actionable API errors.

## Real MySQL concurrency check

The local dedicated `ytt` database was initially absent. It was created and the
application migrations ran successfully; no unrelated database, existing `.env`
or application key was changed. Normal fixture campaigns were created through
the browser, not direct SQL.

An additional guarded local QA script ran **4 independent PHP processes × 10
moves** against the explicitly marked QA campaign. These used the real
`TokenActions`/`SceneTransaction` and MySQL row locks, not an HTTP server that
serializes all requests. Starting at revision 18, results were every revision
19–58 exactly once. Final revision was 58; restoring the original world position
was revision 59. No lost increments or duplicate revisions were observed.
The ignored script is `artifacts/check-concurrent-revisions.php`; it requires the
specific local QA fixture. This is a correctness check, not a throughput benchmark
or a multi-GM conflict-resolution test.

## Browser vertical slice

Playwright drove Chromium against Laravel at `http://127.0.0.1:8000` with the
production bundle and real MySQL. A separate Vite/StrictMode pass followed.

1. Registered a QA GM, created a campaign and an empty scene, with no seeded demo.
2. Uploaded an original procedural PNG test map, created a token at viewport
   center and assigned a separately uploaded token image.
3. Edited name, HP/max HP, AC, speed, rotation 45°, scale 1.3 and controller through
   Inspector. Hidden/locked controls persisted and reflected in GM treatment.
4. Dragged with 20 pointer samples: **0 requests while held, 1 POST on release**,
   payload `{x:870,y:570}`. Snapped coordinates matched the subsequent snapshot.
5. Set grid size 80, offsets `(10,-15)`, disabled snapping, changed map X to 12.5,
   and activated the scene. Snapshot before and after reload was identical.
   Inspector restored X/HP/hidden/locked values correctly.
6. Created another scene: no previous tokens, one canvas, editing changed while
   the active scene remained Moonlit Crossing. Renamed, switched back and used
   browser Back; URLs and scene contents were correct.
7. Created/deleted a token in the second scene, then deleted the inactive scene.
   Deleting the active scene was rejected with the deactivate-first explanation.
8. Signed out, verified API 401, tested invalid login, signed back in and reopened
   the campaign. Saved state remained intact.
9. Dropped an image onto the tabletop to replace the map. New asset attached;
   original private asset remained available to its GM. Removal was also tested
   in a temporary scene without deleting image storage.
10. Uploaded a **3,608,765-byte PNG** through the browser with per-process PHP
    upload limits 16M/20M. This verifies the path beyond PHP's stock 2 MiB limit.
11. Locked drag generated no write. Middle/Space pan and cursor zoom generated no
    domain writes and left `(870,570)` unchanged.

The local server was restarted with the documented per-process upload settings;
no system `php.ini` was modified. The QA campaign/accounts and retained private
images are local test data, not application seed data.

## Error and security browser paths

- A fake PNG containing PHP text was rejected with an image-format explanation.
- Real backend validation rejected map width 0. Save failed remained visible;
  confirmed Reload saved restored server state.
- Intercepted HTTP 503 on a token edit: local HP was 29, saved HP remained 34,
  footer showed Save failed. Retry persisted 29 and advanced revision once.
- A later rejected edit was explicitly discarded through Reload saved; the
  last confirmed HP returned. No silent reset occurred.
- Intercepted asset 503 showed the media-load recovery state. Reload after service
  recovery rendered the map again with one canvas.
- A separate authenticated non-member received HTML 403 with no workspace/canvas
  and JSON 403 for the private map URL. Guest API access returned 401.
- Normal interaction produced no JS exceptions. Native HTTP console errors in
  the log correspond to deliberately exercised 401/403/422/503 failures.

The 503/asset outages are browser interception tests, not a physical network or
server outage. Backend permissions are additionally exercised by feature tests.
Player UI/realtime were not implemented or claimed as browser-tested.

## Development lifecycle and visuals

Vite/React StrictMode boots one canvas, loads private imagery and uses the same
save queue shown by the footer. A forced failed mutation displayed Save failed;
Retry saved successfully. Self-review fixed a double-initializer command binding
hazard by constructing SceneStore and its persistence queue as one pair. Media
loading now waits until renderer initialization completes.

Visual inspection covered custom desktop/mobile login, campaign cards, real scene
sidebar, map/token Inspector, native dialogs, map/scene empty states, save/error
status, and active-scene indicator. The Task 01 design system and canvas layout
remain. Requested widths 1920, 1440, 1366, 1180, 1179, 900, 899, 768 and 390 were
checked without document horizontal overflow or duplicate canvases. At 390 px,
library/Inspector open/close paths remain usable with one overlay at a time.
A tablet regression hiding Activate was fixed and rechecked at 768 px.

Ignored evidence screenshots are in `artifacts/task02-*.png`, including workspace,
mobile Inspector, campaign picker and desktop/mobile authentication. They are
QA evidence, not assets needed to run the application.

## Repeatable acceptance

1. Configure a new dedicated MySQL database, migrate, build and start Laravel with
   sufficient upload limits. Register instead of seeding an account.
2. Create a campaign and scene; upload PNG/JPEG/WebP; place/size/remove/replace map.
3. Add a token, upload an image, edit transforms/vitals/owner, hide and lock it.
4. Drag with and without snap; inspect requests; verify only a committed drop saves.
5. Change grid calibration, reload and compare the snapshot/Inspector values.
6. Activate scene A, edit scene B, refresh and use browser Back/Forward; A stays active.
7. Try deleting active A; deactivate first and retry. Delete a token with confirmation.
8. Force a failed mutation, verify visible unsaved state, Retry or explicitly reconcile.
9. Exercise private image load failure and recovery, fake upload and unrelated-user URLs.
10. Sign out/in; reopen the campaign. Resize panels/viewport and check one canvas.

## Explicit limits

Revision is not optimistic concurrency control; concurrent field edits are last
accepted write wins. Retries do not yet have command IDs, so a lost accepted
response can produce a second revision. Create/upload retries need manual
reconciliation. Pending edits live in memory with an unload warning, not durable
offline storage. Other tabs do not receive updates automatically. Reconnect,
Player UI, invitations, broadcasts, fog, undo, asset GC and a production rollout
remain next-stage work. Safari/Firefox, real touch devices and multiplayer load
were not tested in this pass.
