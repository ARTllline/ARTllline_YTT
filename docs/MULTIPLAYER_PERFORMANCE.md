# Multiplayer performance — Task 33

Measured on 2026-10-30 in the supported **native Windows runtime**, PHP 8.3.32,
MySQL 8, built Vite assets, Chrome, 1 GM + 2 independent Player contexts, active
Reverb connections, existing Townhouse campaign/scene 5. No Docker or production
configuration changes. Redis remains optional; file sessions/cache and MySQL Cue
queue are preserved.

## Reproduction and method

Before implementation, 12 HP requests with all three clients reproduced HTTP
p50 **1009 ms**, p95/max **1817 ms**. Eight session reads measured 186/936/936 ms.
Then opt-in instrumentation was added, followed by a ten-round baseline containing
60 Next Turn commands, movement, weapons, spells, NPC attacks, HP and conditions.
AoE, transfer, loot, death saves and rest were measured separately as well.
The baseline harness stopped after AoE because it selected an old zero-quantity
potion stack; the transfer/loot/rest tail was resumed with the live stack. No
failed harness request is counted as a successful operation.

The final comparison used the same commands, actors and prepared scenario with
three live canvases and real browser fetches. GM corrections replenish HP/slots
between samples and temporarily reposition existing actors for a repeatable AoE;
these setup requests are excluded from operation timings. No new accounts,
campaigns, scenes or sessions were created. Baseline rare weapon/NPC outliers
(15.7/7.0 seconds) are retained; their exact individual cause was not isolated.
Nearest-rank percentiles, no discarded warm samples. Small groups (4–12) have
p95 equal to their maximum and are descriptive, not statistical guarantees.

Artifacts are ignored locally under 'artifacts/task33-performance/': untouched,
before, before-tail, final JSON samples, server query aggregates, client frame and
revision marks, UI-click correlation, concurrency and reconnect reports. These
contain diagnostic identifiers only; account credentials are read privately from
the existing fixture file and never copied into reports. Raw browser heaps are
not saved.

## Browser HTTP results

Milliseconds; each timing cell is **p50 / p95 / max**, n is before/after.

| Operation          |     n |               Before |           After |
| ------------------ | ----: | -------------------: | --------------: |
| Movement           | 10/10 |   1254 / 2121 / 2121 | 180 / 297 / 297 |
| Weapon attack      | 10/10 | 1006 / 15746 / 15746 | 324 / 417 / 417 |
| Condition          | 20/20 |   1534 / 2274 / 3295 | 154 / 193 / 336 |
| HP                 | 10/10 |      591 / 795 / 795 | 208 / 321 / 321 |
| Next Turn          | 60/60 |   1480 / 2309 / 3551 | 271 / 453 / 809 |
| Spell attack       | 10/10 |   1411 / 2576 / 2576 | 246 / 332 / 332 |
| NPC attack         | 10/10 |   1383 / 7029 / 7029 | 239 / 422 / 422 |
| AoE spell          |   8/8 |   1289 / 2104 / 2104 | 310 / 560 / 560 |
| Inventory transfer | 12/12 |    507 / 1223 / 1223 | 330 / 441 / 441 |
| Loot pickup        |   8/8 |    415 / 1129 / 1129 | 204 / 267 / 267 |
| Take All           |   4/4 |    376 / 1118 / 1118 | 211 / 248 / 248 |
| Death Save         |   8/8 |   1349 / 1597 / 1597 | 332 / 394 / 394 |
| Long Rest          |   4/4 |   1222 / 1879 / 1879 | 281 / 317 / 317 |

Most common-command p95 values are now below 500 ms. Next Turn, weapon attacks
and transfers still exceed the approximate 250 ms median target; AoE has a
560 ms tail. The goal is substantially improved, not a claim that every target
was met. Background activity can still queue work on Windows' single HTTP worker.

## Where the missing time went

Next Turn medians (60 samples each):

| Phase                                     | Before ms | After ms |
| ----------------------------------------- | --------: | -------: |
| Browser HTTP                              |      1480 |      271 |
| HTTP minus measured Laravel lifetime      |      1023 |       70 |
| Laravel lifetime                          |       434 |      188 |
| PHP/Laravel bootstrap to first middleware |       136 |       11 |
| SQL aggregate                             |        87 |       52 |
| Command wrapper, including transaction    |       245 |      157 |
| Controller/application dispatch           |       218 |      145 |
| Combat DTO                                |        38 |       15 |
| Character rosters                         |        67 |       49 |
| Recipient DTO/broadcast preparation       |       116 |       83 |
| Synchronous broadcast dispatch            |        14 |        7 |
| Outer transaction open, until committing  |       227 |      148 |

These spans **overlap**, and median differences do not add up to median HTTP.
HTTP minus Laravel includes listener backlog, pre-bootstrap time, browser/network
scheduling, diagnostic file writes and response delivery; it is not labelled as
pure DB lock time. SQL includes lock acquisition. Pure JSON serialization,
individual policy/session/CSRF middleware and actual MySQL commit fsync are not
separately isolated: they remain inside the enclosing spans. No security
middleware was removed. The commit_callbacks metric includes commit plus Laravel
afterCommit callbacks and must not be mistaken for pure commit time.

Read-only /up comparisons while the three baseline clients were active showed
~1.2–2.2 s through the old launcher despite ~145–170 ms inside Laravel; a direct
PHP listener measured ~166–274 ms, and warmed OPcache ~13–17 ms inside Laravel.
Idle old/direct listeners both measured roughly 140–165 ms. This supports a
single-worker backlog amplified by compilation and refresh traffic; it does not
prove that every delay was caused by artisan serve. Its child output is polled
at 500 ms intervals and is no longer in the serving path. DNS/connect checks
were around 1 ms; Reverb's warmed health connection was around 1 ms.

The important causes were:

- PHP recompiled Laravel on each request without OPcache; all HTTP clients share
  one Windows built-in server worker.
- One accepted mutation replaced Character objects and triggered inventory GETs
  even when the semantic state did not change. Ability close also repeated the
  accepted-command refresh.
- DTO assembly repeatedly loaded the same active effects, Characters/equipment,
  combat, token conditions, loot metadata and spell-turn slot state for recipients.
- Full Character rosters remain expensive and large. Reverb transport itself was
  a small fraction of command latency.

## Implemented changes and boundaries

The native launcher starts the PHP HTTP process directly in public/, detects
installed OPcache (including relative extension_dir), and enables it for this
process only. Timestamp validation remains on with revalidate_freq=0, so source
edits apply immediately. Missing OPcache produces a warning and fallback. The
system PHP, private .env and production are unchanged. Editing .env now requires
stop/start. Queue, scheduler and Reverb processes retain their existing commands.

Existing SpellEffects.project() now covers complete immutable DTO assembly,
including recipient payload preparation. Its bounded read map reuses combat,
condition, casting scene/turn-slot and token-loot reads. Character/equipment
relationships demonstrated in the trace are eager-loaded in roster/combat DTOs.
All projection reads clear in finally, including exceptions; command execution
outside projection reads fresh. No persistent combat cache or permission cache
was introduced. Shared snapshot locks and campaign/scene writer locks remain.

Inventory refresh depends on semantic Character contents instead of object
identity. An opaque content hash also changes when quantities, equipment,
definitions or legacy item abilities change. It is recomputed from authoritative
state, not persisted/cached. Casting availability, rules and resources remain in
the dependency, so relevant gameplay changes still refresh. A Player accepted
ability has one scene convergence refresh; dialog dismissal does not repeat it.
Inventory after actual item changes still refreshes. This reduced combined
inventory GETs from 272 in the baseline ten-round/AoE portion to 120 in the entire
final scenario, which additionally includes transfers, loot, death saves and rest.
Those counts include explicit benchmark setup reads; they are not a like-for-like
per-second reduction claim. Revision/reconnect probes and reference-catalog
refreshes remain for correctness. Pixi is still mounted once per scene.

## SQL and payloads

Median query counts per measured command, including recipient-safe DTO work:

| Operation          | Before | After |
| ------------------ | -----: | ----: |
| Movement           |    149 |    89 |
| Weapon attack      |    424 |   227 |
| Condition          |    131 |    78 |
| HP                 |    192 |    96 |
| Next Turn          |    244 |   143 |
| Spell attack       |    235 |   126 |
| NPC attack         |    216 |   120 |
| AoE spell          |    248 |   208 |
| Inventory transfer |    233 |   152 |
| Loot pickup        |    147 |   107 |
| Take All           |    146 |   106 |
| Death Save         |    168 |   113 |
| Long Rest          |    139 |    99 |

A representative Next Turn active-effect campaign query fell from 33 repetitions
to 9 and Character-by-ID reads from 25 to 7. Remaining repeats occur in separate
immutable DTO boundaries and mutation phases; they are intentionally not shared
across writes. Trace files include normalized query shape, count, aggregate and
maximum query duration without bindings. Normal local single-worker samples do
not isolate contested DB waits; the two-process regression below verifies actual
serialization against the same MySQL database.

No entire map/fog/notes snapshot was added to ordinary gameplay events. Existing
scoped token/combat mutations and separate GM/Player filtering remain. However,
Character rosters are still included by existing charactersChanged paths. HTTP
Next Turn remains 26,558 bytes; aggregate application event JSON for its three
recipient channels is ~188,261 bytes versus ~187,565 before (inventory identity
metadata accounts for the small increase). Typical final HTTP sizes: movement
9,064 B; weapon result 1,524 B; spell result 1,674 B. Aggregate event JSON per
command is ~20 KB for movement/conditions, ~144–163 KB for HP/spell/death-save,
~303 KB for weapon attacks and ~314 KB for transfers which publish twice. These
are serialized application-envelope bytes, not compressed wire bytes or a single
Player packet. Realtime payload size was measured, not falsely claimed reduced.

Broadcast ordering remains **locked mutation → materialize filtered DTOs →
commit → synchronous safe dispatch → HTTP response**. Measured dispatch p50/p95
for Next Turn is 7/8 ms; moving it to an asynchronous queue would add ordering,
retry and outage complexity for little demonstrated benefit. Existing logged
transport failure + authoritative probe/reconnect recovery remains. DTO creation
stays within the locks to avoid mixed-revision events. Lock narrowing was not
justified by these measurements.

Final restored-fixture read-only snapshot checks (3 per role, three canvases): GM p50/p95 105/107 ms, Player1 107/107 ms, Player2 105/117 ms. Snapshot response sizes: actor 1: 109262 B; actor 2: 35116 B; actor 8: 53907 B.

## Actual click → visible update

18 actual GM Next Turn button clicks, with the ordinary API client, origin socket
exclusion, both Players connected. Browser clocks use epoch timestamps; Node WS
receipt timestamps have a few milliseconds of scheduling/skew, so a state mark
can slightly precede the externally observed receipt mark.

| Measured span                           | p50 ms | p95/max ms |
| --------------------------------------- | -----: | ---------: |
| Intent mark → API request start         |     18 |         27 |
| Request start → response headers        |    273 |        339 |
| Request start → JSON parsed             |    275 |        471 |
| Intent → remote event observed          |    289 |        368 |
| Intent → remote React DOM mutation      |    288 |        367 |
| Intent → remote Pixi render of revision |    289 |        368 |
| Event observation → Pixi render         |      1 |          5 |

Thus API/service timing is not substituted for visible latency. Existing pending
controls stay immediate and authoritative outcomes are never claimed optimistically.

## Regression and long-session evidence

The final workload completed ten rounds, 60 advances and all listed action
families. Next Turn first/last 20 samples were p50 258/274 ms and p95 432/404 ms:
no progressive latency increase. Each client received 291 correlated events with
zero duplicate mutation/revision/type keys and retained one canvas after reload.
rAF p95 was ~8–9 ms (GM/Player2 throughout; Player1 final sample is after reload),
with isolated max frames of 25–383 ms, not a steady smoothness regression.

Additional 12-round/72-advance checks: 299/390/475 ms initially. The exact-heap
repeat measured 279/404/1394 ms while the full SQLite suite was also running, so
its single tail outlier is retained and not used as the primary comparison.
After forced Chrome garbage collection and clearing diagnostic buffers, exact JS heap grew GM 8.7 → 10.1 MB, Player1 9.1 → 14.4 MB, Player2 9.4 → 18.6 MB over 12 rounds. GM DOM/listener counts stayed 1167/349; Player counts grew by roughly 1800 nodes and 296 listeners. One canvas and zero duplicate websocket events exclude renderer remounts and duplicate subscriptions as the explanation. Sanitized heap inspection did not establish the owning retainer conclusively. This is a real unresolved long-session finding, not a claim of leak-free memory stability; no speculative React refactor was applied.

Two separate native PHP listeners, the same MySQL database, real existing
sessions and simultaneous requests confirmed:

- duplicate inventory transfer UUID: 200/200, one quantity moved;
- duplicate Next Turn UUID: 200/200, identical authoritative result;
- different Next Turn UUIDs against the same expected turn: 200/409;
- simultaneous pickup of one remaining loot item: 200/409, one owner;
- duplicate attack UUID: 200/200, identical rolled result.

These contended pairs completed around 0.49–0.72 s, including cold setup on the
second listener and actual campaign serialization. They test correctness, not a
claim of equal parallel-command latency. Broad campaign writer serialization
remains deliberate.

A Player was disconnected while GM changed HP, condition and position (three
revisions), then reconnected/reloaded and reconstructed the authoritative Character
state. All clients had one canvas. Reload also passed at the end of the main
workload. Player snapshots remained owner-filtered with no GM notes, hidden flags,
NPC combat profiles or check DC fields. Existing backend suites cover hidden
objects, private effects/conditions/loot, role changes on receipt replay and
permission revocation; no common GM payload is broadcast to Players.

## Validation and reproduction

- Backend: 283 tests / 3954 assertions, isolated SQLite in memory.
- Frontend: 210 tests / 44 files.
- TypeScript, ESLint, production build and Pint: passed. Existing warnings remain
  for an unresolved decorative divider URL and a >500 KB dice chunk.
- Native doctor: 9 OK, 2 existing warnings (optional Redis, nightly FFprobe build).
  Docker doctor is intentionally not used under the current AGENTS native contract.
- Permanent fixture restored with php artisan qa:townhouse after checks; temporary
  alternate listeners stopped; supported native services remain running.

Start with scripts/local.ps1 start and reuse the existing three accounts from
TEST_PLAYGROUND.md in independent browser contexts. To inspect a local request,
send X-YTT-Perf: 1 from loopback while APP_ENV=local. Server-Timing and
X-YTT-Request-ID correlate with clientMutationId; sanitized aggregates append to
storage/logs/performance.jsonl. Headers/logging are off otherwise and production
refuses opt-in. An optional __yttPerformance callback installed before startup
receives http.start/headers/complete, state and Pixi revision marks. It receives no
payloads. There is no continuously running observability service or CI millisecond
threshold. Browser intent/WS observation can be collected with ordinary DevTools
or a local Playwright installation; the ignored QA harness preserves the exact
measured fixture workflow without adding a production dependency.

## Remaining work and one recommendation

Single-worker Windows HTTP queuing, full runtime rosters and reference/background
polling still dominate the remaining budget. No WAN, production PHP-FPM, physical
phone or concurrent eight-player capacity result is implied by local Chrome QA.
Recommend exactly one next task: **Player HUD long-session memory retention**. Capture the growing DOM/listener retainers without gameplay changes, fix the owning lifecycle, and verify plateau over 50+ rounds. Smaller runtime DTOs remain a measured follow-up opportunity, but the observed retention takes priority.
