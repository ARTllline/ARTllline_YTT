# Task 14 — visual and interaction validation

Validated locally **2026-10-29 Europe/Kiev**, Chromium 156.0.8078.74.
See [the 18-section report and 14 screenshots](TASK14_VISUAL_POLISH.md).

- Three screenshot/interaction passes, followed by the final responsive matrix.
- 1920×1080: clean, session, combat, assets, cue editor, inspector, radial.
- 1440×1000: clean, session, combat, radial; 768×1024: table/session; 390×844: Player.
- No horizontal overflow, duplicate canvas or page errors in the final matrix.
- Radial: keyboard/outside/Escape, persisted lock/duplicate, existing Combat path,
  prop/region actions, four edges, touch long press with stable camera, reduced motion.
- Native token drag → server → real Player Reverb update → Undo; hide/reveal filtering.
- Native library drop with saved feedback; Cue reorder/restore/save; Combat and Session
  next/previous; Inspector → Combat → Audio → close; wheel world-anchor invariance.
- Frontend: **127 tests / 26 files**, typecheck, lint and build passed.
- Backend: **89 tests / 1169 assertions**, Pint passed. `git diff --check` passed.
- Fresh heavy scene benchmark: 200 props, 36 tokens, 1200 fog strokes, 2 image textures,
  one canvas, mask 2048². 240 rAF intervals: p50 **8.3 ms**, p95/max **8.5 ms**.
  Same recorded frame percentiles as Task 13. DOM 309; approximate heap 15.45 MB.
- Evidence: `artifacts/task14-final-screenshots.json`, `task14-pass3-interactions.json`,
  `task14-extra-report.json`, `task14-performance.json` and the linked PNGs.

Physical tablet input and Firefox/Safari are unverified. Portrait aspect ratios retain
letterboxing under Fit to preserve the full map. Server DTOs do not carry allegiance;
hostility is not invented in the presentation layer. No production rollout was made.

The sections below are historical validation records for earlier tasks.

# Task 13 — workspace redesign validation

Validated locally **2026-10-29 Europe/Kiev**, starting at `93899cf`.
See [the complete redesign report](TASK13_REDESIGN.md) for the information architecture,
all 13 mandatory screenshots, performance comparison and remaining UX concerns.
No backend, schema, dependencies, `.env`, production deployment or commit/push changes.

## Current checks

| Check                        | Result                     |
| ---------------------------- | -------------------------- |
| `composer test`              | 89 passed, 1169 assertions |
| `npm run test`               | 119 passed, 23 files       |
| `npm run typecheck`          | Passed                     |
| `npm run lint`               | Passed                     |
| `npm run build`              | Passed                     |
| `php vendor/bin/pint --test` | Passed                     |
| `git diff --check`           | Passed                     |

Six reducer tests cover contextual/explicit panel replacement, clean state and tablet
behavior. Three selection-layout tests cover drag deferral, cancellation and unmount
cleanup. Browser testing caught and fixed the first-drag cancellation caused by opening
the Inspector on pointer-down: geometry now changes after the gesture completes.

## Browser and workflow evidence

Chromium 156.0.8078.74: 1920×1080 (clean/scenes/Inspector/combat/assets/cue editor/session),
1440×1000 (clean/combat/session), 768×1024 (GM/session), 390×844 (Player). All 13 states:
one canvas, no document overflow, zero page errors. Reduced-motion disables panel
animation; the keyboard palette is bounded to 640px. The mobile Player initiative
starts collapsed. Captures were visually reviewed, including corrected editor colors,
palette sizing and tablet header behavior.

Real authenticated GM and Player contexts exercised token drag/persistence/Reverb,
movement Undo, native asset drag/drop, manual fog, ruler/ping, palette activation and
navigation, media start/stop, handout broadcast, encounter placement and cue launch.
The cue completed all three steps through the real queue. Session note flush before
mode changes and audio failure/retry with the original UUID were explicitly checked.
Hidden token data was absent from the Player snapshot, not merely visually concealed.

QA writes are confined to campaign **13**, scenes **40–42**, with API-authored fixture
content and actual UI captures. No old campaign was reset. Campaign 12/scene 39 was
used for a read-only renderer comparison: 200 props, 36 tokens, 1200 fog actions,
4096px map and two textures. At 1440×1000, 240 warm rAF samples gave p50 **8.3 → 8.3ms**,
p95 **8.4 → 8.5ms**, max **8.5 → 8.5ms**. Default DOM size **1836 → 301**. Sixteen dock
transitions plus pan/zoom retained the original canvas and texture count. This short
headless sample is not a long-running GPU or memory benchmark.

Local evidence: `artifacts/task13-ui-report.json`, `task13-workflows.json`,
`task13-additional.json`, `task13-browser-report.json`, `task13-before-metrics.json`,
`task13-after-metrics.json`, `task13-composer.log`, `task13-frontend.log` and matching
`.cjs` scripts / `.png` screenshots. These QA artifacts are ignored by Git. Firefox
launch was attempted but its executable is absent; no current Firefox/Safari/device
or production/WAN sign-off is claimed.

The sandbox cannot resolve Vite test modules on B: or reach localhost; verified runs
used approved execution outside that restriction. Full Pint initially reported only
an old ignored QA helper's formatting; it was corrected and Pint passed afterward.

# Task 12 — V1 stabilization validation (historical)

Validated **2026-10-29 Europe/Kiev** from clean Task 11 commit `845c1c5`.
No dependency/lockfile, `.env`, APP_KEY or schema changes; no commit/push or VPS
deployment. Earlier milestone sections below are historical, not current limitations.
All destructive/fixture writes used new QA campaign **12**, synthetic files or new
restore databases. Existing campaigns were not reset. Screenshots/scripts/raw metrics
are local ignored `artifacts/qa12-*`; retained test fixtures are clearly QA-labelled.

## Acceptance disposition

Candidate for a first supervised local Chromium/Firefox session. This is **not an
unconditional production/Safari sign-off**. The actual Linux PHP-FPM/systemd reboot,
Redis deployment, external WAN, real Safari/macOS/iPad and multi-hour evening soak
remain release-environment gates in V1_RELEASE_CHECKLIST.md. No new major subsystem
was implemented to work around those limits.

## User workflows actually exercised

- Three independent Chromium contexts, GM and two Players; campaign/scenes/map
  upload/invite/join through UI, authored supporting content through authorized APIs.
- Mixed marquee selected two tokens + prop. Group drag saved; toolbar Undo restored
  both kinds, Ctrl+Shift+Z redid and Ctrl+Z undid. Pure selection/camera creates no write.
  Shift marquee toggled only intersected objects without changing revision 31.
  A live concurrent token move made Undo reject/resync rather than overwrite x=870.
- Selective handout to Player 1: Player 2 list remained empty; authorized viewer
  opened. Revoke selected closed it and its old asset URL returned 403. Show-all
  opened both. Player 2 went offline during revoke-all and closed on reconnect.
- Full **Последний маяк** plan: start Session; Player token crosses private region;
  once trigger reveals a guard, starts music/rain, focuses camera and shows message;
  letter shared; encounter placed/added to combat; four combatants advance through
  three rounds; fog cover/reveal strokes, ruler and ping; preload next scene reports
  both Players ready while the current scene stays active; activate second scene;
  scene trigger starts embers/SFX/camera/boss combat; advance to private final note;
  complete Session. Plan persists with completed status and timestamps. No client errors.
  Follow-up Player circle AoE was received as a remote overlay by the second Player.
- Under Chromium network emulation (350 ms latency, 200000 B/s download, 100000 B/s
  upload), 21 real API requests completed: activation/snapshot, movement/inverse,
  fog cover/reveal, damage/heal, condition add/remove, next turn, selective handout
  show/revoke, music pause/resume, atmosphere, preload, Cue save/start. Individual
  requests took 373–408 ms. Reload reconnected. This measures HTTP command recovery,
  not arbitrary packet loss/jitter on a real WAN or every editor control under latency.
- Deliberately dropped the HTTP response **after** an accepted UI token move. Visible
  unsaved/error state offered Retry; Retry reused the exact UUID. Revision 9→10 only,
  no second movement/revision. Queue unit tests also cover inverse response loss.
- Terminated the actual Reverb process. Players showed disconnected state, then
  rejoined after restart: both scene 39 revision 103, same token coordinate 300.
- Stopped the actual database Cue worker; accepted run stayed queued through GM
  reload. Restart completed all steps. A camera focus on a hidden target failed with
  an actionable Russian error; reveal + Retry completed that same run/step identity.

## Browsers and layout

Actual Playwright engines, production build: Chromium **156.0.8078.74**, Firefox
**153.0**, Windows WebKit **26.5**. GM 1440×1000 and 1024×768; Player 390×844 with
touch capability. Canvas, private images, 1200-stroke fog, zoom/pan, resize, reload,
connection and audio-unlock control exercised. All three hydrated one renderer with
two unique image textures, 200 props and 36 tokens; zero page errors. The narrow
header now wraps, keeping audio unlock reachable; role labels in the Inspector are
translated. Large-map Fit no longer has the 20% floor that cropped a 4096px map.

Important WebKit observation: initial render works, but viewport resize sometimes
produces a blank composited canvas screenshot. Context is not lost, GL error is 0,
ticker continues, and synchronous renderer readback produces the correct scene.
Reload restores display. This unresolved Windows-harness observation prevents
claiming real Safari acceptance. Its fractional display scale also reports a one-CSS-
pixel scrollWidth rounding difference; visual header overflow itself was corrected.
Audio unlock was clicked; this is not an audible hardware/codec test on Safari.

## Performance and load

Synthetic 4096×4096 map, 200 props sharing an image, 36 tokens, 30 private notes,
1200 fog strokes; rain/snow/embers changes. **722.572 seconds**, GM + **six distinct
Player users**, **266** accepted movements and **8** scene activation round-trips.
Zero page errors and no observed private-note sentinel in Player WS frames. At end
all seven renderers were ready, each with one canvas/two image textures and the full
public scene. GM rAF interval p50 about 8.3 ms / p95 about 8.4 ms (120 Hz host); this
is animation-frame scheduling, not a GPU timestamp or low-end device guarantee.
JS heap samples 16.6–42.5 MB, repeatedly returning around 19–25 MB. Post-warm-up DOM
stayed 2355–2357 nodes; listener counts varied 781–5383 and fell again with GC, rather
than growing monotonically. This finite run found no obvious unbounded leak; it is
not proof of multi-hour stability. The original synthetic cover enum was normalized
from `hide` to the API's `cover` before follow-up checks (both render as cover).

Follow-up on the final large-map zoom code: 80 GM editor scene transitions (40
round-trips) with zoom and explicit GC samples. All checkpoints retained one canvas,
two image textures, 2355–2357 DOM nodes and 494–781 listeners. CDP used JS heap was
12.03 MB initially / 12.85 MB finally, peak sampled 13.39 MB; zero page errors.
This exercises renderer teardown/recreation, separately from the multiplayer soak.

Fog masks stayed 2048×2048 for the 4096-square scene. The two RGBA masks represent
about 32 MiB; the uncompressed map about 64 MiB, excluding driver/framebuffer overhead.
1200-action hydration succeeded in all engines. No history compaction was introduced
without a measured need; payload/first-frame cost and precision remain documented.

Production bundles: entry 282.67 kB / 88.97 kB gzip; shared live scene 173.00 / 52.24;
GM workspace 47.16 / 13.82; renderer 325.46 / 101.17; CSS 60.03 / 13.15. Renderer and
GM preparation panels remain lazy chunks. These are build sizes, not total network
transfer including private assets.

## Security, operations and restoration

- New regressions cover GM-only inverse edits, atomic conflict, foreign-scene objects,
  exclusion of HP, private notes/regions and no trigger replay; handout foreign
  campaign/recipient denial, Player recipient-list privacy, revoke asset/thumbnail
  denial, receipt replay and former-member grants. Existing cross-campaign, hidden
  entity, private media, inactive channel, preload and trigger/Cue tests still pass.
- Rate-limit audit retains login/register 10/min, invite lookup 30/min, join 20/min,
  uploads 30/min, interaction 60/min, media/SFX 120/min, ping 4/sec and other spatial
  previews 20/sec. No new throttle interferes with ordinary movement. Player asset
  projections contain opaque authorized URLs/dimensions, not filesystem paths or
  original filenames; private file endpoints recheck authorization on each request.
- Bounded logging replaces raw Cue/probe exception reporting with identifiers and
  exception classes. No new debug logs or hardcoded localhost application paths.
  Removed the unreferenced Task 01 procedural MapLayer; demoScene remains test-only.
- Nginx configuration syntax passed using isolated loopback ports 8088/8443 and PHP
  FastCGI 9012 with a two-day QA self-signed certificate. Actual HTTPS login, Secure
  session cookie and **five WSS subscriptions** succeeded. Browser discovery alone
  was redirected to the QA WSS endpoint; the publisher retained local Reverb. Dotenv
  403, arbitrary PHP 404, private storage path 403, unsigned publisher path rejected.
  This does not validate a public trusted certificate or Linux FPM socket/systemd boot.
- `bash -n scripts/backup.sh` passed in WSL. systemd unit verification found the
  expected missing `/usr/bin/php` in this minimal WSL; no Linux services were installed.
  Docker CLI exists but daemon is unavailable. No successful reboot test is claimed.
- Doctor local exit 0: PHP/DB/storage/private disk/queue/Reverb/application and
  scheduler heartbeat OK. Warnings: local Redis absent, FFprobe nightly version
  outside stable-version recognition, stock CLI upload limits. Production mode
  intentionally treats missing Redis/secure configuration as errors.
- Execution pruning dry run: zero eligible, retention 90 days. Isolated tests verify
  old completed runs are removed, failed/busy/recent runs and definitions preserved.
- **Real MySQL restore rehearsal**: created new databases
  `ytt_qa12_20261028_230430_source` and `ytt_qa12_20261028_230430_restored`; migrated
  synthetic source; dumped with mysqldump; changed token/deleted source map reference
  and file; imported into the second new DB and restored file into a new directory.
  Authoritative scene snapshot compared exactly; map SHA-256 matched
  `ae36099e87dffec9ec0cd7b96c20984b211bf5f70233ac2d7484ff034a965507`.
  Restored counts: 1 campaign/scene/asset/token. Working database was never an import
  target. This rehearses the DB+file restoration, not restoration of all real campaigns.

## Automated checks

`composer test`: **89 tests / 1169 assertions**. `npm run test`: **110 tests / 21 files**.
Typecheck, ESLint, production build, full `pint --test`, Composer strict validation,
platform requirements and `git diff --check` pass. Added coverage is limited to
new inverse/history/marquee/access/doctor/pruning behavior, the note-queue regression
and large-map camera fit. Deployment-host and real-device gates above remain open.

# Task 11 validation (previous milestone)

Validated locally on **2026-10-29 (Europe/Kiev)**, on top of the uncommitted Task 10
work. PHP 8.3.32 / Laravel 13.39, MySQL, Reverb, database Cue queue and Chromium with
the production frontend. Applied additive migration
`2026_10_29_001000_create_regions_and_triggers`; restarted Cue workers after code
changes. No dependency/lockfile, APP_KEY or environment changes; no deployment or
commit/push. Existing campaigns were preserved. New disposable campaign **11**
(`QA11 · Кладбище у тракта`), scenes **34/35**, two existing QA Player accounts and
new synthetic door artwork were used for live acceptance.

## Automated checks

- **84 backend tests / 1105 assertions** pass, including 11 Trigger tests and every
  previous suite. Geometry covers footprint contact, corners and circle boundaries;
  final enter/exit vs inside/preview/snapshot; filters, disabled region/trigger,
  millisecond cooldown boundary (4999 ms vs 5000 ms), once, batch movement; same-scene
  reference validation; Player authorization, hidden token/prop, locked visible prop,
  stale epoch and receipt replay; activation, combat start retry, round threshold and
  same-round jump; real CueRunner execution/order; A → B → A suppression and depth
  bound; revoked author; cancellation of a queued run without clearing another run.
- **101 client tests / 18 files** pass. Four new region geometry tests plus a regression
  for legacy empty-array private revision payloads. Existing persistence, realtime,
  geometry, combat, Director, audio, sessions and preloading tests remain green.
- TypeScript, ESLint, production build, full Pint, strict Composer validation,
  platform requirements and `git diff --check` pass. Pint initially caught formatting
  in ignored QA helpers; those helpers were formatted and the full check rerun.
- SQLite migration up/down is exercised by backend tests; local MySQL migration up
  was applied successfully. Production migration/deployment is not claimed.

## GM + two Players, real browser and queue

Three isolated browser contexts joined campaign 11. GM drew a rectangle using the
new tool, renamed it, created the trigger through the visual editor, and activated
the scene. Player 1 dragged the owned token across the boundary. The database worker
ran the existing Cue: the previously hidden ghost appeared and both Players received
the prepared public message. No extra GM action was needed.

Circle drawing, rename, drag movement and handle resize persisted as centre
1233.488/883.488 and radius 123.488. Show-regions hid the graphics while the trigger
remained enabled. Region creation/updates survived reload. Navigating from editing
scene 34 to scene 35 disposed the prior graphics/selection and loaded the new scene's
trigger list. An empty-scene upload prompt initially intercepted drawing; it now
yields to drawing tools and disappears once regions exist.

Live movement checks produced: first enter count **1**, immediate leave/re-enter
still **1**, leave/re-enter after 5.1 s count **2**, movement within still **2**,
Player refresh/offline/reconnect still **2**. A separate exit trigger fired **once**.
Opening another editing scene and reactivating the same active scene produced no
activation fire. Switching active scene away and back produced **one** activation
fire. Begin Combat plus identical retry produced **one** start; Jump within round 1
produced **zero** round fires; next to round 2 produced **one**. Preload + both Player
refreshes added **zero** fire-history rows.

Player selected the visible door prop and pressed **Взаимодействовать**; its Cue
displayed the public door message. Selection alone produced no fire. After hiding
the prop, a direct Player interaction POST returned **403**. Revealing it restored
interaction. With the GM context offline, Player interaction still ran through the
server worker and delivered its message. Player controls remain generic for visible
tokens/props, including targets with no trigger.

Session Mode started a prepared plan and kept the **Триггеры: 6 включено** indicator.
The GM disabled and re-enabled the enter trigger directly from its panel. During
this verification, freshly-created session responses were fixed to refresh database
defaults before projection; status/revision are now usable immediately. Re-selecting
the current session no longer clears its loaded plan.

## Actual MySQL once concurrency

After resetting the once trigger and placing both owned tokens outside, two separate
PHP processes ran final TokenActions movement concurrently against the QA fixture.
Both entered the same region. Each held the normal campaign lock for 700 ms to force
overlap (helper `artifacts/qa11-race.php`, restricted to campaign 11/tokens 205,206).

| Process           | Started (Unix seconds) |     Lock acquired |          Finished |
| ----------------- | ---------------------: | ----------------: | ----------------: |
| 41320 / token 205 |      1793226565.459236 | 1793226565.459931 | 1793226566.221169 |
| 43236 / token 206 |      1793226565.530774 | 1793226566.210471 | 1793226566.955018 |

The second process waited approximately **680 ms** for the same lock. Both final
positions persisted at 850/450; the trigger count became **1**, history grew by
**exactly 1**, and that row referenced exactly one queued/completed CueRun. This is
separate-process MySQL evidence, not a claim based on sequential SQLite HTTP tests.

## Privacy and regression found during acceptance

Player network capture included **259 WebSocket frames and 937 successful API
responses** at the audit point: zero matches for private `СЕКРЕТ` names or the keys
regionId, actorFilter, cooldownMs, fireCount, cueId, scene_regions, scene_triggers.
Player snapshots had no regions/trigger definitions; GM-only read/write routes and
hidden target denial are covered by backend authorization tests. Actual Cue output
contains only the existing authorized object/presentation results.

Live QA exposed a prior empty-payload transport issue: PHP `[]` arrived as an array;
the client used `map in payload` and treated Array.prototype.map as scene-map data.
Private revisions could then break image loading. Server empty payloads now encode
as `{}` and the reducer tolerates legacy arrays. Existing projection assertions and
a client regression test cover it. After rebuilding/reloading, region edits, trigger
toggles, prop hide/reveal and all later checks produced **zero page errors**.

## Layout and performance

- Trigger panel and editor inspected at **1440, 768, 390 px**. Panel had no internal
  horizontal overflow and stayed within the viewport; body had none. The parent
  dialog was widened to fit its content. The narrow GM top bar now wraps within its
  own height, and region controls are above the combat overlay. Player prop selection
  and the interaction button were checked at 768/390; 1440 was used for multiplayer.
- In scene 35, **40 regions / 40 enabled region triggers**: 100 read-only detector
  samples, median **4.0406 ms**, p95 **4.4265 ms**, max **9.6397 ms**, exactly **3 SQL
  queries per movement**. Both benchmark endpoints were outside all regions; it
  measured detection/database reads, not Cue execution, network latency or commits.
  The helper changes only an in-memory active-scene projection, no live activation.
- With 40 rendered regions and an actual Space-pan gesture after focusing canvas:
  240 rAF intervals, median **8.3 ms**, p95 **8.4 ms**, maximum **16.7 ms** on this
  local Chromium/display. **Zero region mutation requests during pan**. A region
  drag sends only its final command. These are local measurements, not a cross-device
  performance guarantee; no spatial index was justified.
- Main entry remains **282.67 kB / 88.97 kB gzip**. Lazy TriggerPanel **11.71/4.19 kB**,
  RegionControls **3.11/1.34 kB**; renderer **323.59/100.63 kB**. No new dependencies.

Screenshots and local evidence are ignored artifacts, including `qa11-regions.png`,
`qa11-player-enter.png`, `qa11-interact.png`, `qa11-panel-{390,768,1440}.png`,
`qa11-editor-390.png`, `qa11-workspace-{390,768,1440}-final.png`, and
`qa11-player-{390,768}.png`. QA browser contexts are closed after acceptance.

## Limits / next stage

The existing Cue queue worker and scheduler remain required. Failed CueRuns pause
later automatic runs until Retry/Stop. Once consumes at accepted run creation;
reset is explicit. At 100 unfinished runs the originating command fails atomically.
Enabled count includes consumed once definitions. History has no retention job yet.
Interaction has no distance/ownership requirement. Only endpoint overlap is tested;
teleport-through, geometry edits and newly spawned tokens do not create enter events.
Polygon/DSL/if-else/variables/loops/random/scheduling/HP/condition triggers/macros/
graph/LOS/spatial audio remain deferred. No production deployment was performed.

---

# Task 10 validation (previous milestone)

Validated locally on 2026-10-28, starting from clean Task 09 commit `2afd4ec`.
PHP 8.3.32 / Laravel 13.39, existing MySQL/Reverb/Cue worker, Chromium and production
frontend. Applied additive `2026_10_28_000900_create_game_sessions` to the local
database; restarted the existing Cue worker for the updated media URL projection.
No dependency/lockfile, APP_KEY or environment changes; no deployment or commit/push.

## Automated coverage

- **73 backend tests / 964 assertions**, including six new Session tests. Coverage:
  plan CRUD/order/references, compare-and-swap conflicts, one active session,
  missing/cross-campaign references, focus without table side effects, resume,
  completion retaining notes/scene/combat/music and deletion retaining resources;
  GM-only list/detail/resources/mutations and role-changed receipt replay;
  safe manifests, opaque Range/206 delivery, hidden/handout/outsider denial,
  unchanged URLs after activation, readiness count/batch/freshness checks,
  late membership, expiry/revision invalidation, optional audio with no playback,
  Cue-definition grant revocation and byte limits. Migration up/down runs in tests.
- **96 client tests / 17 files**. New tests cover ordered moves/nearest next scene,
  two-download concurrency, exact-URL reuse, byte limits/LRU/teardown, denied/aborted/
  oversized/expired resources and retained/released Blob URLs for combat portraits.
  Existing scene, renderer geometry, combat, persistence, Director and audio tests pass.
- Typecheck, ESLint, production build, Pint, strict Composer validation, platform
  requirements and `git diff --check` were run. No new package was installed.

Backend tests use isolated SQLite and fake private storage. Browser checks use the
separate explicitly labelled **QA10 · Ночь старого тракта** campaign (10), scenes
29–33 and a nine-item session plan. The heavy fixture is newly generated synthetic
content, not copied private state from an existing campaign. QA files/screenshots
are under ignored `artifacts/`; they are not application seeds.

## Real session with a GM and two Players

Three separately authenticated browser contexts completed:

`Chapter → Tavern → Handout → Cue → Note → Forest → Encounter → Boss Scene → Boss Cue`.

- Created all nine items in the planner; reordered using a drag grip, duplicated
  and removed a temporary note, and saved the linked plan. Up/Down ordering and
  reference preservation also have deterministic tests.
- Started Session Mode; Next and item jumps changed focus only. The Tavern stayed
  active and no handout appeared until **Показать игрокам** was explicitly clicked.
  Both Players received the prepared letter. The first Cue ran on the real worker.
- Activated Forest, placed the prepared encounter, used **Добавить в бой**, and
  started combat. Both Players received the same combat state. Activated the Boss
  scene and ran its Cue: reveal, music, SFX, embers and message used existing systems.
- Reloaded the GM during the active session: current item, private notes and live
  mode returned. A simulated lost response after the notes write had committed
  retried with the **same mutation UUID** and retained the exact saved text.
- End displayed its confirmation. Completion retained the focused item and final
  notes; active scene, combat and all live media fields (excluding `serverNow`)
  were unchanged. Reload showed the completed read-only plan, and clicking its
  Note item exposed the stored private reminder for review.

## Preload, authorization and recovery

- Automatic nearest-scene preparation made Forest ready for both Players while
  Tavern remained active. Manual Boss preparation included its map and two opted-in
  audio files: **3 resources / 391,672 bytes**. It created zero audio elements before
  explicit playback and did not reveal the hidden Boss token.
- Examined the Player manifest and pre-activation WebSocket payloads. The manifest
  contained only batch UUID/expiry and opaque URL/kind/bytes. No secret scene name,
  token list, GM note, Cue definition, encounter or future handout metadata appeared.
  Player session list, session resource picker, inactive snapshot and hidden-image
  requests returned **403**. No secret metadata appeared in captured pre-activation
  frames. Backend tests additionally cover opaque/numeric media route boundaries.
- Interrupted a Player while **two resource requests were in flight**. GM status
  showed that Player loading while the other was ready. Reconnect recovered both
  to ready, 3/3. A new participant received 403 before joining, appeared waiting
  after joining and became ready from the current batch without a new GM preload.
- Forced media GET failures: the Player showed a retry label, GM readiness became
  failed, and Retry recovered after the forced failure was removed. Initial scene
  image errors stayed visibly above the dark transition with a reload button.
- Forest activation completed for Players in **709 / 714 ms**, with zero repeat
  opaque media GETs. Boss activation was **853 ms**, also without re-downloading
  prepared resources. Real audio elements used cached `blob:` URLs and played after
  the explicit browser Unlock gesture.
- Initial heavy-scene validation found an extra combat-portrait GET. CombatPanel now
  shares the same cache; the final activation measured **852 ms** and **zero repeat
  resource GETs across both Players**. An offline third participant did not block it.
- An image-free scene also completed the transition. The initial media key now
  distinguishes 'not loaded' from an empty resource list. The fade does not hide
  renderer/media errors; reduced motion disables its duration.

These timings are local activation-to-presented-scene observations, including
snapshot/network/renderer setup, not zero-latency promises. The cache avoids media
transfers; initial decode/upload and authoritative snapshot hydration still occur.

## Layout and performance

Inspected GM live console, planner and Player View at **1440, 768 and 390 px**.
No horizontal document overflow; one canvas per Player. At narrow widths the GM
console overlays the table and remains closable. The selected note editor and Save
button remain reachable on the 390 px planner. Desktop retains the scene as the
main workspace. Screenshots include `task10-live-{width}.png`,
`task10-planner-{width}.png`, `task10-planner-selected-390.png`,
`task10-player-{width}.png`, `task10-heavy-session.png` and
`task10-session-completed.png`.

Synthetic heavy scene: **4096×3072 map, 200 props, 30 tokens, 208 fog operations,
20 GM notes, 15 active combatants**. Three distinct generated image files total
49,189 encoded bytes: this stresses scene composition/texture dimensions, not WAN
bandwidth or hundreds of distinct large images. The normal Boss preload separately
exercises audio download. Frame samples use 360 requestAnimationFrame intervals in
each condition on this local Chromium/120 Hz environment:

| Condition                         |    p50 |    p95 | Maximum | Frames >20 ms |
| --------------------------------- | -----: | -----: | ------: | ------------: |
| Normal Player View                | 8.3 ms | 8.4 ms |  8.5 ms |             0 |
| Normal view during preload        | 8.3 ms | 8.4 ms | 16.7 ms |             0 |
| Heavy Player: pan/zoom/ruler/ping | 8.3 ms | 8.4 ms |  8.5 ms |             0 |
| Heavy GM Session Mode             | 8.3 ms | 8.4 ms |  8.5 ms |             0 |
| Heavy Player during next preload  | 8.3 ms | 8.4 ms |  8.5 ms |             0 |

Scene revision stayed **208 → 208**, with identical token/prop positions after the
camera/spatial-tool performance pass. No application page errors were observed.
One QA-script wait initially called getComputedStyle before its element existed;
the guarded wait was corrected and recovery was rerun. Forced HTTP failures above
were deliberate. No multi-hour soak, WAN, Safari, physical tablet or low-end GPU
claim is made from these short local samples.

## Bundle and loading boundaries

Production Vite build, decimal kB (uncompressed / gzip):

| Chunk                       |                      Size |
| --------------------------- | ------------------------: |
| Main app                    |        **282.67 / 88.97** |
| Shared scene/realtime       |            162.60 / 49.06 |
| GM Workspace                |             45.39 / 13.14 |
| PlayerView                  |              10.06 / 3.93 |
| SessionConsole              |              17.63 / 6.29 |
| SessionPlanner              |               5.49 / 2.45 |
| AssetLibrary / AssetDetails |  6.77 / 2.70; 4.35 / 1.86 |
| CueLibrary / CueEditor      | 5.63 / 2.42; 15.04 / 5.18 |
| MediaPanel                  |               7.18 / 2.80 |
| TabletopRenderer            |            319.09 / 99.33 |

Task 09 main was 506.23 / 153.51 kB: the main chunk is about **44% smaller** and
Vite emits no 500 kB warning. This is not a claim that a whole GM route costs 283 kB:
main + shared + Workspace are about 490.66 kB before renderer/backend-specific Pixi
chunks, CSS and optional panels. The Player route avoids the GM Workspace/editor
chunks. Loading follows existing feature boundaries, without duplicate state stores.

## Limits / deferred

- 128 files / 128 MiB encoded cache, two download/decode workers, 30-minute batches;
  no persistent offline cache. Large map/audio content must be intentionally granted.
- Readiness is advisory downloaded-byte state, with a 45-second lease and last-tab-
  per-user reporting. GPU readiness and autoplay permission are separate. A changed
  scene invalidates preparation and needs another preload.
- Notes retry in the current page; unsaved text is not a durable offline journal.
  Simultaneous GM note edits are last accepted write. Plan saves detect conflicts.
- Triggers/Regions, calendar, scheduling, recordings, automatic recap, AI summaries,
  full campaign journal, LOS and voice/video remain deferred. Multi-hour and slower
  device/network verification are appropriate next acceptance work.

# Task 09 validation

Validated locally on 2026-10-28 over the existing uncommitted Task 07/08 work,
preserving campaign data, APP_KEY and environment. PHP 8.3.32, Laravel 13.39,
MySQL, Reverb, the real Cue database worker, Chromium and the production build.
Applied only additive `2026_10_28_000800_create_live_media`. No Composer/npm
dependency changes, commit/push or deployment. FFprobe is now a documented runtime
requirement for audio uploads; the installed executable was exercised, not mocked.

## Automated coverage

- Backend: **67 tests / 848 assertions**. Eight new Media tests cover actual WAV
  probing/upload, duration, private media, Range/206, thumbnail denial, Player list/
  write denial, cross-campaign assets and recipient-scoped channel authorization.
  They also cover replacement/crossfade grants and expiry, pause/resume elapsed time,
  four-ambient bound and independent removal, weather start/stop, stale scene commands,
  activation cleanup with retained music, shared volumes, non-loop expiry, HTTP UUID
  replay/conflict, single SFX publication without replay state, and Cue step duplicate
  delivery/cancellation retaining already applied continuous state. Existing tests pass.
- Client: **90 tests**. Ten new engine tests cover autoplay gating, discarded locked
  SFX, approximate reconnect position, looping/non-looping offsets, crossfade cleanup,
  independent ambient, bounded/duplicate/expired/wrong-epoch SFX, local gain persistence,
  pause/resume, complete teardown, scene activation before missed media repair, an
  atmosphere update not shortening an existing fade, and stale SFX crossing reconnect.
- Typecheck, ESLint, production build, Pint, strict Composer validation, platform
  requirements and whitespace checks run for the final implementation. The audio
  panel is a separate lazy chunk. Vite reports its 500 kB warning for
  the main bundle (about 506 kB uncompressed after this stage); renderer remains lazy.

PHP tests use isolated SQLite and fake private storage; generated probe input is a
real mono PCM WAV. They do not migrate/replace working campaign tables.

## GM + two independent Players

Dedicated **QA09 · Звук и атмосфера** campaign 9, active scene 27 and transition
scene 28. GM plus two independently authenticated browser contexts and separate
local preferences. Generated local test media: MP3 music/impact, OGG Vorbis music/
wind, WAV rain. These are test tones/noise, not a bundled media library.

- Uploaded batches through the actual Asset Library. Cards reported 40-second music,
  15-second ambient and 1.5-second SFX, with independent results. Uploaded a further
  **18,240,078-byte / 190-second WAV** successfully after restarting only the local
  HTTP process with `upload_max_filesize=64M`, `post_max_size=68M`. Existing `.env`
  and system PHP configuration stayed unchanged. Search/tags/collections/rename use
  the same existing library path; audio detail/delete usage has explicit coverage.
- GM preview created no Player audio elements and the secret audio GET returned 403.
  Starting music while Players were locked still created zero Player elements.
  Actual **Включить звук** clicks enabled both contexts. Instrumented real Web Audio
  analyser outputs had nonzero waveform peaks, elements were playing/readyState 4,
  and sampled positions were 8.369/8.370 seconds. This verifies browser audio output
  processing, not a claim of physically listening to the user's speakers.
- Replaced MP3 Track A with OGG Track B through the panel; outgoing elements were
  released and both Players played B. Reloading one Player required Unlock again,
  then restored B near the other Player's position (sample 23.907/23.898 seconds).
  Rain + wind played together; Stop Rain removed only rain, with wind continuing.
- Player 1 offline during Impact: Player 2 created the one-shot, Player 1 did not.
  Reconnect/reload hydrates only continuous state. A final engine boundary also rejects
  unexpired packets whose start predates reconnect, rather than relying only on the
  five-second expiry. Local master 20% on Player 1 left Player 2's defaults and the
  shared 70%/60%/80% mix unchanged; the local preference survived reload.
- Final production-bundle reconnect check repeated the exact same SFX command UUID
  after Player 1 returned online: **0 SFX requests on Player 1, exactly 1 on Player 2**.
  Both retained restored rain (75 shapes) and music, with sampled positions
  28.591/28.590 seconds and nonzero output signals. No application page errors.
- Music pause stopped the current elements; resume continued from saved elapsed time.
  Scene 28 replaced scene 27 with **zero particles**, empty ambient/effects and the
  same continuing music element on each Player. Returning to 27 did not resurrect
  its old weather. Campaign 9 was returned to scene 27 after this check.

## Prepared cinematic and cancellation

Saved **Появление босса** (12 actions): blackout, stop ambient, impact, reveal hidden
boss, focus, shake, restore image, music with 2-second fade, strong embers, add combatants,
begin combat, message. Actual Run button executed the sequence on the queue worker;
both Players received audio/state and the Player message displayed over the table.
Music/embers remain after completion. Opened the saved music action in the visual
editor, verified campaign asset choices/fade/volume/loop and saved through the UI.

A second cue applied music + rain, flash + vignette, then a long Wait before removing
rain. Actual Stop cancelled future actions while music/rain remained. Flash's CSS
animation was observed at one second, and a second run with reduced-motion emulation
rendered the pulse `display:none`. Director cancellation cleared presentation without
resetting the independent audio service. Fresh application contexts recorded zero
JavaScript page errors.

One initial cinematic wait exceeded the test's 20-second timeout: the first worker
job took ~14 seconds and the run nevertheless completed all 12 steps. A repeat
reached the message normally in the bounded check. This stage does not promise hard
realtime Cue deadlines. Earlier browser automation retries involved a collapsed
sidebar, asynchronous server-confirmed checkbox state, exact-label matching and a
QA helper assuming private notes existed in Player snapshots; these were harness
issues, not evidence of app success before the corrected checks.

## Visuals and interaction

GM panel, Player sound controls and Cue audio editor inspected at **1440 / 768 / 390 px**.
No document or panel horizontal overflow in final captures. The GM's local sliders
collapse under **Моя громкость**, leaving frequent live controls visible. Mobile
panel was ~374 × 714 px within 390 × 844; Player controls ~374 × 316 px. Cue dialog
remained inside the viewport with independent scrolling and an accessible Save button.
All new controls, validation messages and autoplay states are Russian.

An initial screenshot exposed inherited topbar `white-space:nowrap` and padded range
inputs; explicit panel wrapping and compact range sizing fixed it. An initial engine
pass exposed subsequent weather updates restarting an unchanged gain ramp; target
deduplication now preserves the configured fade. Both have repeated checks/tests.

Ignored screenshots: `task09-audio-final-{1440,768,390}.png`,
`task09-player-audio-390.png`, `task09-cue-music-{1440,768,390}.png`,
`task09-boss-player.png`, `task09-heavy-final.png`.

## Heavy scene measurement

Used the existing QA scene 24: **4096×3072 map, 200 props, 30 tokens, 208 fog actions,
15 combatants, 20 notes**. Two 360-frame rAF samples with focused-canvas Space-pan,
zoom, ruler and ping, one without media and one with playing music plus strong rain,
embers and haze (**150 Pixi particle shapes**):

| Sample                 | p50    | p95    | Maximum |
| ---------------------- | ------ | ------ | ------- |
| Final current baseline | 8.3 ms | 8.4 ms | 8.5 ms  |
| Audio + three effects  | 8.3 ms | 8.4 ms | 8.5 ms  |

Screenshots were taken after timing. Final before/after scene revision was **248**
and token/prop arrays were identical. The first unfocused QA gesture moved one QA
prop instead of panning; its original fixture position was restored through the
normal API, preserving revisions/receipts, and both samples were repeated with
explicit canvas focus. A prior stage's different moved prop was left unchanged.
QA campaign 7's original active scene 21 was restored and test music stopped.
These are local browser frame intervals, not GPU timings, WAN guarantees or a soak.

## Remaining boundaries

No Safari/Firefox/physical-touch/audio-device matrix, production proxy or eight-player
load claim. Tested OGG Vorbis; Opus is accepted by the validator but was not separately
browser-auditioned. Audio should be encoded in one supported pure-audio stream; embedded
cover art is currently rejected. HTTP Range delivery targets the existing local disk;
remote storage needs its own equivalent adapter. FFprobe and PHP/proxy upload limits
must be configured on another host. Reconnect is approximate, outgoing grants expire,
and downloaded bytes cannot be revoked. Cue/HTTP idempotency inherits existing receipt
retention; SFX deliberately has no recovery replay. Triggers, spatial audio, waveform
editing, microphone, streaming integrations, dynamic LOS and Session Mode remain deferred.

---

# Task 08 validation

Validated locally on 2026-10-28 over the existing Task 07 working tree, preserving
its uncommitted changes. PHP 8.3.32, Laravel 13.39, MySQL 8, Reverb 1.12, Node
20.20.2 and Chromium. Applied only the additive Cue migration. Existing campaigns,
private assets, APP_KEY and environment were preserved. No dependency changes,
automatic commit/push or production deployment.

## Automated checks

| Command                        | Result                               |
| ------------------------------ | ------------------------------------ |
| `composer test`                | **59 tests / 757 assertions passed** |
| `npm test`                     | **80 tests passed**                  |
| `npm run typecheck`            | Passed                               |
| `npm run lint`                 | Passed                               |
| `npm run build`                | Passed; editor/library lazy loaded   |
| `php vendor/bin/pint --test`   | Passed                               |
| `composer validate --strict`   | Passed                               |
| `composer check-platform-reqs` | Passed                               |
| `git diff --check`             | Passed                               |

Eight new PHP tests cover ordered CRUD, immutable execution snapshots (including
definition deletion), GM/Player and cross-scene boundaries, unsupported executable
types, sequential Wait/early delivery, combat integration, cancellation during Wait,
activation cancellation/inactive-start rejection, hidden-focus denial and retry,
start HTTP receipt replay, duplicate encounter/prefab/handout deliveries, stale-run
recovery, actual database job insertion, and rollback after an injected failure
between spawn and combat. Retry then commits exactly once. Tests use isolated
SQLite/fake storage, not working campaign tables.

Seven new client tests cover event deduplication/order/epoch, automatic terminal
release, old-run terminal messages arriving after a newer run, lease/message expiry,
failed-step retry, Escape/reconnect cleanup, ticker camera interpolation/reduced
motion and immutable editor reorder/defaults. Prior scene/props/combat/fog tests
remain green. Run position, not the seven-day HTTP receipt retention, provides
durable step idempotency.

## Real GM + Player acceptance

Dedicated **QA08 · Режиссёрская мастерская** campaign 8, active scene 25 and prepared
scene 26. Separate authenticated GM and Player browser contexts, production bundle,
real MySQL/Reverb and an actual `queue:work tabletop --queue=cues --sleep=0.1`
process. QA media copied through authorized upload from earlier generated QA images.

- Built **Засада гоблинов** through the visual editor: reveal two hidden enemies,
  Wait 400 ms, message, medium shake, add to combat, begin. One Run click revealed
  the enemies, displayed the Player message/shake and produced active round 1 with
  two combatants. Before reveal, Player had only the owned scout, no secret props,
  and GET definitions returned 403. Captured frames contained no hidden boss name.
  The completed run cleared all Director UI and freed the camera.
- **Появление демона** executed fade → Wait 700 ms → reveal boss/prop → object focus
  → zoom → restore image → shake → message → release. Exercised editor duplicate,
  delete and real drag reorder; saved nine-step order matched the intended sequence.
  Focus carried only x/y/duration, no target ID/name. Camera ended at zoom 1.4; only
  the two persistent reveals changed revision (r16→18). Measured event spacing was
  about 1.254 s for 500 ms fade + 700 ms Wait, 1.215 s for a 1200 ms focus, 1.510 s
  for a 1500 ms zoom, and 5.009 s for a five-second message. No old effects replayed.
- Refreshed GM during a focus/60-second Wait/move/message run. GM reopened Events
  and saw its running card. Set Player offline, verified immediate local cleanup,
  stopped the verified queue worker during the Wait, reconnected/reloaded Player:
  run remained at position 2 and prop X remained 800. Restarting the worker completed
  the saved plan, yielding X=900 and completed position 4. No GM browser timer was
  needed. The earlier shorter interruption attempt completed before the stop and
  is not counted as the worker-restart acceptance.
- Spawned a mixed prefab and encounter, added the latter to combat, and showed a
  handout through one run. After completion, the guarded ignored PHP QA script
  delivered each of those three jobs three more times. Before/after remained exactly
  **7 tokens, 2 props, 1 handout reveal, revision 24**. The client initially opened
  the handout normally; automated event tests also verify one presentation only.
- Started move X=1000 → focus → Wait 60 seconds → move X=1100. Clicked the actual
  **Остановить** button during the displayed Wait. Run became cancelled, Player
  camera/overlays cleared and X stayed 1000. The future move did not execute.
- Hid the boss, ran focus on it and saw the Russian failed-step explanation with
  **Повторить шаг / Остановить**. Player frames contained no boss identity or
  coordinates. Revealed it, pressed Retry, observed focus and automatic completion.
- Created/saved an event on inactive scene 26. Run button was disabled with a reason;
  direct start returned 409. GM editing did not change Player's active scene.
- Final mobile cinematic check verified combat/tools/help/zoom HUD hidden during
  direction, visible after Esc, and empty Director presentation after release.
  Fresh acceptance contexts recorded no JavaScript page errors.

An early offline pass exposed dependence on WebSocket heartbeat timeout; an explicit
browser offline reset now clears immediately, and the repeated pass above confirmed
it. An old QA browser context retained prior fault-injection instrumentation and
reported navigation-context errors; final recovery/visual checks used a fresh Player
context. Expected HTTP 403/409 and the deliberately failed hidden-focus step are not
normal-flow failures. The first ignored replay script used a nonexistent relation;
it was corrected before the successful before/after measurement above.

## Visuals and responsive behavior

Inspected the timeline, action settings, cinematic message and completion/retry/stop
states. All new user-facing terminology is Russian; technical action keys remain
internal. The editor was checked at **1440, 768 and 390 px**, with dialog bounds
inside the viewport and no horizontal document overflow; one canvas remained.
Player messages at those widths were bounded (at 390 px, about 354 px wide), with
plain text wrapping and a visible local release button. The final Player screenshot
uses 390×844. No physical touch/Safari/Firefox claim.

Resizing initially unmounted the open editor through the workspace's automatic
library collapse. The breakpoint handler now preserves a library with an open modal;
the repeated width sequence retained the editor. User close/unload still warns for
unsaved drafts. Mobile sequence/settings scroll inside the bounded dialog, while
Save remains available. The editor is a separate ~19 kB uncompressed lazy chunk;
the main app bundle stays below Vite's 500 kB warning threshold.

The final dirty-draft check also resized an edited title to **390×844**, retained
the exact draft, and measured a roughly **378×831** dialog inside that viewport.
After restoring/saving the original title, the final production bundle completed
the cinematic again on the restarted worker with no page exceptions.

Ignored local screenshots: `task08-editor-{1440,768,390}.png`,
`task08-ambush-message.png`, `task08-cinematic-{1440,768,390}.png`,
`task08-final-cinematic-mobile.png`, `task08-final-cinematic-desktop.png`,
`task08-heavy.png`. Earlier cinematic images
predate the final HUD suppression; the final mobile image reflects it.

## Heavy scene regression

Reused the Task 07 fixture without changing its domain data: **4096×3072 map,
30 tokens, 200 props, 208 fog actions, 15 combatants, 20 notes**, three cached images.
A 360-frame rAF sample during Space-pan, wheel zoom, ruler and ping measured
**p50 8.3 / p95 8.4 / max 16.7 ms**. Task 07's same-style sample was 8.3/8.4/8.5 ms.
Screenshot was taken after timing. A separate 360-frame direct-renderer camera zoom
sample measured **8.8 / 16.9 / 25.0 ms**, with **zero React onZoom callbacks during
the directed animation**. It used the production renderer transition directly;
server-to-Player execution was verified separately above. No >20 ms p95 regression.

These are local browser frame intervals, not GPU timings or hosted performance
guarantees. No long soak, WAN/load benchmark or eight-player cinematic capacity claim.
Existing synchronous broadcast, fog-history growth and large-image GPU constraints
remain. Many-object reveal/hide currently delegates successive canonical mutations
inside one atomic step; very large groups can take longer than one batched spawn.

## Operations and remaining boundaries

`tabletop:recover-cues` completed successfully with zero overdue runs after acceptance;
`schedule:list` includes the every-minute recovery and existing daily receipt cleanup.
Local HTTP, Reverb, the refreshed Cue worker and `schedule:work` were left running.
README documents the explicit database connection, worker, scheduler, restart and
cancellation semantics. Delays are minimums and may increase under load; the
subsecond tail is handled server-side without holding locks. A broker outage can
drop ephemeral effects; reconnect restores persistent state only, and terminal-loss
safety expiry releases cameras. There is no cinematic replay/outbox guarantee.

Run retention/history browsing, live collaboration on a definition, bulk visibility
optimization, undo of completed actions and production supervision remain next work.
Triggers, regions, automation conditions/loops/variables, scripts/macros, audio/music,
weather/particles, dynamic LOS and Story integration are deferred. Future Triggers
can invoke the existing validated CueRunner/action boundary without a new state
synchronization or mutation implementation.

---

# Task 07 validation

Validated locally on 2026-10-28 against clean committed Task 06 (`bc4b243`).
Laravel 13.39, PHP 8.3.32/GD/WebP, MySQL 8, Reverb 1.12, Node 20.20.2 and Chromium.
Applied only the additive reusable-content migration to local MySQL. Existing
campaigns, assets, environment and APP_KEY were preserved. No automatic seed,
dependency change, commit, push or production deployment.

## Automated checks

| Command                        | Result                               |
| ------------------------------ | ------------------------------------ |
| `composer test`                | **51 tests / 682 assertions passed** |
| `npm test`                     | **73 tests passed**                  |
| `npm run typecheck`            | Passed                               |
| `npm run lint`                 | Passed                               |
| `npm run build`                | Passed                               |
| `php vendor/bin/pint --test`   | Passed                               |
| `composer validate --strict`   | Passed                               |
| `composer check-platform-reqs` | Passed                               |
| `git diff --check`             | Passed                               |

Seven new backend tests (112 assertions) cover visible/hidden prop transitions,
private image denial, mixed batch move/duplicate/delete, one revision and receipt
replay, relative prefab transforms in another scene, asset reference protection,
independent instances after definition deletion, fresh encounter HP/ownership/conditions,
existing combat integration, cross-campaign IDs, locked-group rollback, stack gaps/ties,
hidden neighbours, empty hidden-only Player frames and inactive-scene isolation.
Prior combat/preparation/multiplayer/security tests remain green. Tests use isolated
SQLite and fake storage; browser acceptance uses the configured local MySQL.

Eleven new client cases cover Russian fallback/interpolation/error mapping, preset
condition labels versus custom content, mixed selection and resync cleanup, a coherent
token+prop realtime patch with deletion and revision gaps, lost-response UUID reuse
for prefab/encounter/duplicate, mixed drag preview versus one snapped commit, rotated
resize cancellation, Shift toggle and locked-group movement denial. A regression in
the first batch reducer (legacy token array overwriting batch tokens) was fixed and
is covered. The shell test now asserts Russian title/boot text and `lang="ru"`.

## Browser workflows and security

Separate **QA07 · Мастерская игровых сцен** campaign (7), scene 21 (tavern),
22 (ambush) and 24 (heavy fixture). Earlier QA campaigns were left intact. Existing
GM and Player accounts joined through a new invitation. QA fixture images are
generated local graphics; no external copyrighted assets were downloaded.

- Uploaded a transparent 400×240 PNG as **Объекты**, then used a real native card
  drag to create prop 1. Named it, set 30° rotation and 200-pixel width in Inspector.
  Saved values and Player projection agreed. Hiding removed it entirely from Player
  snapshot and made its original image return 403; revealing restored it.
- Real Shift-click selected token 122 plus prop 1. One release sent exactly one
  `/selection` request containing both IDs and one UUID. Scene r9→r10 moved token
  to (570,630) and prop to (510,570), preserving their offset. Player's live store
  showed both accepted positions at r10.
- Ctrl+D with the committed HTTP response deliberately aborted showed Russian Retry.
  Retrying produced exactly one new token/prop pair (two of each total). Saved that
  mixed selection as **Лагерь у дороги — стол и часовой** through the name dialog.
- Switched to scene 22 and dragged the prefab card onto the table. Aborted its
  committed response, then clicked Retry. Both requests used UUID
  `773b9c4e-6a2b-49a8-9241-ac2e0fe587af`; scene remained r1 with one token and one prop.
  Relative offset (60,60), rotation 30° and scales 0.5/0.3 survived the spawn.
- Selected four tokens in the scene outline and saved **Патруль гоблинов**. The
  source archer had 2/20 HP, a Player owner and Poisoned; the boss was hidden.
  Deleted the source selection through the confirmation. Spawn response loss and
  Retry used UUID `018f1ad7-abc7-4c8d-9476-78ac99174530` twice and produced exactly
  four tokens. Archer started 20/20, all owners null, all conditions empty. Player
  received three tokens and no hidden boss. **Добавить в бой → Начать бой → Следующий
  ход** used the existing tracker; GM had four combatants, Player three.
- Rotated corner-handle resize changed prop scales to 0.8222/0.3928 while retaining
  30°. Lock → attempted drag left revision 22 and position (570,390) unchanged;
  unlock restored editing. Asset detail usage included both scene props and prefab.
- Created/edited a GM note with Russian default title, changed marker to stable key
  `secret`, saved Russian title/body and closed with Escape. Player snapshot omitted
  notes. Captured Player WS frames for a hidden prop edit and note body edit were
  empty `scene.revision` payloads at r18/r19, with no names or private fields.
  Direct Player definition-list request returned 403.
- Stopped the verified local Reverb process, changed prop visibility via HTTP while
  it was down, then restarted it. Player displayed **Нет связи · повторная попытка**,
  returned to **На связи** without reload and resynchronized to r17 with no hidden
  prop, note or definition payload. HTTP and Reverb were left running afterward.
- Prepared an image handout, entered Russian description, Preview → Show to Players.
  Player's Russian overlay opened at 390 px with bounds approximately 378×833 inside
  390×844. Existing image privacy and handout behavior remained functional.

Deliberate failed requests, private 403s, missing-page 404 and broker interruption
generated expected console/network errors. No normal-workflow JS exception was found.
Selector retries during QA are not counted as application failures. The heavy fixture
initially used a wrong combat field and rolled back; it was corrected to `position`.
Its copied fog history also received the source revision before new strokes were tested.

## Russian UI and layout

Audited login/register, campaign/scene shell, library/filter/upload/details, template
cards, inspectors, grid/fog/ruler/AoE/ping, combat/conditions, notes, handouts, keyboard
help, confirmation/error/empty states and Player/wait/connection surfaces. New display
labels are centralized in `ru.ts`; Laravel validation/boot/defaults/error HTML use
`lang/ru`. No automatic translation of historical names or user text. English fixture
names, filenames and content remain intentional, as do HP/AC, X/Y, formats and key names.

Browser audit caught and fixed technical-value localization in drag MIME and note
option values, a raw tag placeholder, and overflow from the longer Russian asset tabs.
The library now wraps category buttons without horizontal scrolling (222/222 client/
scroll width in the narrow sidebar). Inspected GM at 1440, 768 and 390 px; Player at
the same widths had exactly one canvas and document scrollWidth equal to viewport.
Inspected login at 390 and a Russian 404 page in a separate unauthenticated context.

Local ignored screenshots: `task07-prop-desktop.png`, `task07-encounter-combat.png`,
`task07-library-mobile.png`, `task07-gm-tablet.png`, `task07-gm-mobile.png`,
`task07-player-{1440,768,390}.png`, `task07-handout-mobile.png`,
`task07-login-mobile.png`, `task07-stress.png`. Early prop screenshot predates the
library wrap and rectangular prop preview fixes; later library/tablet images show them.

## Heavy scene regression

Actual 4096×3072 map, **30 tokens, 200 props, 207 fog actions, 15 active combatants,
20 notes**. After all images loaded, a 360-frame requestAnimationFrame sample during
Space-pan, wheel zoom, ruler and ping measured **p50 8.3 ms / p95 8.4 ms / max 8.5 ms**.
Task 06's interaction+screenshot sample was p95 16.7 ms. Current screenshot was taken
after timing, so these are useful local regressions rather than identical benchmarks.
No >20 ms p95 regression warranted profiling. Renderer inspection found 200 prop views
sharing **one Texture**, with **three cached images total** (map, token, prop).
An additional real fog stroke advanced r244→245 and history 207→208; circle AoE also
remained functional. Snapshot secrets and existing combat/spatial tests remained green.

These are browser frame intervals, not GPU timings or a hosted/hardware guarantee.
No hours-long memory soak, physical tablet touch, Safari/Firefox or VPS latency claim.
Manual fog's 2048-side mask/history growth and synchronous broadcast deployment
considerations remain earlier-stage debt.

## Deferred / next stage

Marquee selection, group rotation/scaling, undo/redo, editable template definitions,
optional preset initiative and configurable reduced starting HP remain deferred.
Current reusable tokens start at max HP, explicitly described by the save dialog.
No audio/music, Cue/Director execution, triggers, cinematic camera, weather/particles,
animated-media overhaul, walls/lighting/LOS or Story coupling was added. The explicit
server actions provide the next Cue/Director entry points; multi-step orchestration,
cancellation and recovery need their own design and acceptance.

---

# Task 06 validation

Validated locally on 2026-10-28 against committed Task 05 (`1ce037f`). Laravel 13.39,
PHP 8.3.32 with GD/WebP, MySQL 8, Reverb 1.12.0, Node 20.20.2 and Chromium. The additive
preparation migration ran on the local YTT database. Existing assets received display
names; originals, APP_KEY, environment credentials and earlier QA campaigns were
preserved. AGENTS and dependency lockfiles are unchanged. No production deployment.

## Automated checks

| Command                                              | Result                               |
| ---------------------------------------------------- | ------------------------------------ |
| `composer test` / final `php artisan test --compact` | **44 tests / 569 assertions passed** |
| `npm run test`                                       | **62 tests passed**                  |
| `npm run typecheck`                                  | Passed                               |
| `npm run lint`                                       | Passed                               |
| `npm run build`                                      | Passed; renderer remains lazy        |
| `php vendor/bin/pint --test`                         | Passed                               |
| `composer validate`                                  | Passed                               |
| `composer check-platform-reqs`                       | Passed                               |
| `git diff --check`                                   | Passed                               |

Six preparation PHP tests cover paged combined search/filtering, campaign-local tags
and collections, attach/detach, original-name retention, duplicate-file paths, private
thumbnails, referenced deletion denial/physical unused cleanup, token-image creation
and replacement, old-URL revocation, unique handout discovery/re-show/retry, later
members, no-active-scene access, cross-campaign handout references, actual private
channel authorization, private note snapshots/events, exact-once note creation,
position-only edits preserving body, cross-scene note denial and deletion. Existing
upload spoofing/limits and prior stage suites remain. Tests use isolated SQLite/fake
storage; real MySQL is used separately by browser acceptance.

Ten client cases cover combined query encoding, independent batch failure/success,
invalid drag payloads, camera conversion at 50/100/200%, note hydration/selection
cleanup, GM-only command affordance, note revision ordering/delete/gaps, body debounce
and retained same-UUID retry after closing, plus handout presentation duplicate,
close/reopen/re-show and other-campaign rejection. Backend remains the authority.

Final production-bundle regression also prepared a new handout, closed its first
preview, edited the description without reopening asset details, and saved again.
The persisted handout contained the new description. All automated checks above
were rerun after the final UI fixes.

## Real GM / Player workflow

Dedicated campaign **QA06 · The Cartographer’s Desk** (6), scenes **The Old Observatory**
(18), **Prepared Archive** (19) and **QA06 · Preparation Stress** (20). Existing QA users
joined through a new invitation; a second independent GM cookie context verified
private realtime. Generated QA images were uploaded, not external copyrighted assets.

- Library Upload accepted two maps in one batch while a third SVG reported its own
  failure. Token batch and an image handout also succeeded. Renamed a map, added two
  tags and two collections, then combined search `night`, tag and collection filters:
  exactly that asset remained. Metadata survived reload. Details showed both scene
  usages of a reused map and disabled deletion after the reference check completed.
  An unused generated library fixture was deleted through confirmation.
- Real native HTML drag from a map card placed the empty scene map at r1. A second
  map drag prompted Replace; accepted state appeared for Player. The old map URL
  returned **403**, new map **200**. Map reuse references were checked in two scenes.
- Token-card drops after camera pan at exact **50%, 100%, 200%** yielded snapped
  world coordinates **(330,930), (930,810), (810,690)** respectively, matching the
  camera calculation. Each creation advanced one revision and used the existing
  asset. Dropping onto a token performed PATCH/image assignment instead of creation.
  Early QA drops landing exactly on a snap boundary or an existing token were
  repeated away from those ambiguities; only the final runs establish these values.
  Windows native wheel deltas were quantized, so exact zoom setup dispatched bounded
  wheel events; the actual asset drag/drop still used pointer movement.
- A handout image was **403 before Show**, then **200**. GM preview → Show opened
  Player's modal automatically. Zoom, Escape close, shelf reopen, reload/reopen and
  explicit Show again all worked. The discovered list retained one entry. Description
  hydration initially could overwrite a just-typed draft; editing now waits for its
  metadata read. The title/description save was repeated and verified from the API.
- Note tool → click → title/type/body → immediate Escape retained the draft and saved
  it. Dragging held scene **r15** until release, then saved **r16**, moving the note
  **(450,300) → (630,420)** with its text intact. Reload restored it. Another GM
  received a body edit live. Captured Player frame was only `scene.revision`, r17,
  empty payload; Player snapshot had no notes key or secret text. Local marker
  hide/show left the scene revision unchanged (**244 → 244** in the stress scene).
- Active scene B while editing A: private note and hidden-token edits in A produced
  **zero Player old-scene frames**. A revealed handout reopened while B was active;
  a hidden token image remained 403. Returning to A restored normal state.
- Verified and stopped the local Reverb process. Player visibly showed Reconnecting.
  GM showed **The Lost Star Chart** while the broker was down: HTTP saved discovery,
  no Player popup arrived. Restarted Reverb; without page reload, Player returned to
  Live and the new card appeared in Discovered and opened correctly. HTTP and Reverb
  were left running. This tests a real local broker outage, not production hosting.

Expected HTTP/WS errors occurred for deliberately invalid SVG, denied private files
and the broker interruption. No normal-workflow JavaScript exception was observed.
Screenshots include `artifacts/task06-gm-note.png`, `task06-player-handout.png`,
`task06-library-365.png` and `task06-stress-spatial.png` (local, ignored QA evidence).

## Library scale and renderer regression

The guarded ignored fixture script generated **365 campaign assets**, each with its
own private original path. During 12 page transitions, the library mounted at most
**40 cards**, issued **12 bounded list requests**, **165 lazy thumbnail requests** and
**zero original-image requests for cards**. Largest thumbnail in this synthetic set:
**2912 bytes**. Repeated scrolling did not mount additional pages. An unused fixture
was deleted later, so the final library has 364 of those records.

An initial GC sample taken near image loading showed detached DOM/listener retention
(nodes 1298→3202, listeners 399→969, heap 9.13→9.57 MB). It was investigated rather than
reported as a clean leak test. After waiting for loads and two collections, another
8 page transitions measured nodes **1312→1322**, listeners **402→405**, heap
**9.36→9.36 MB**, and live DOM **620→620**. This bounded pass does not establish an
hours-long memory guarantee. Cards use private no-store responses; the server caches
thumbnail generation, not browser authorization. Huge taxonomies and tens of thousands
of assets remain a separate scaling concern.

Stress scene: actual **4096×3072 map, 30 tokens, 206→207 fog actions, 15 active
combatants and 20 GM notes**. A real fog stroke advanced r242→243 once. Ruler, circle
AoE, ping, Space-pan, wheel zoom and Next Turn remained functional. GM/Player combat
snapshots agreed after Next (r244); Player snapshot still omitted every note. GM
markers render above fog; Player renderer has no GMLayer.

A 180-frame requestAnimationFrame sample during pan/zoom/spatial interaction and
screenshot capture measured **p50 8.3 ms / p95 16.7 ms / max 33.4 ms**. These are local
browser frame intervals, not GPU timings or all-hardware guarantees. Existing fog
2048-side mask/history growth, long GPU soak, immutable combat history and hosted
network-latency debts remain unchanged.

Player handout/shelf layouts at **1440, 1024 (reported CSS 1025), 768 and 390** retained
one canvas, no horizontal document overflow and a viewport-bounded modal. Inspected
GM desktop library, note editor, marker layer and stress-scene screenshots. Physical
touch, Safari and Firefox are not claimed. The viewer uses pointer pan/touch-action,
while full tabletop pinch/touch authoring remains earlier-stage debt.

## Repeat and deferred decisions

Migrate/build using README, enable GD/WebP, start HTTP/Reverb and invite a second
browser profile. Upload a mixed batch, organize/search, drag maps/tokens, replace
images, inspect old private URLs, prepare/show/reopen handouts, place/edit/drag notes,
and inspect Player snapshots/frames. Stop the verified local broker during a Show,
restart it and check discovery. Use only dedicated QA fixtures for scale tests.

PDF, audio/music, Props authoring, Prefabs, reusable Encounters, Cues/Triggers,
Camera Director, cloud adapters, marketplace, AI/image editing, LOS/walls and Story
integration are deferred. Current collections are many-to-many labels, not folders.
Thumbnail generation is synchronous local GD with a bounded memory allowance; S3,
pre-generation/queueing, derivative versions, orphan reconciliation and large taxonomy
pagination require future decisions. Handouts require images and currently share to
all current players; selective UI/revocation/history and text-only documents remain
future work. Pending editor writes and upload status are not durable offline storage.

---

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
