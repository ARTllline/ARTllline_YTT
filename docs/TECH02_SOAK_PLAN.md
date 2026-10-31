# TECH-02 — repeatable multiplayer soak

This is preparation, not closure of TECH-02. Native local runtime only; reuse
Townhouse campaign/scene 5, session 1, GM and both existing Players. Read
[TEST_PLAYGROUND.md](TEST_PLAYGROUND.md) and [TECH01](TECH01_PLAYER_HUD_RETENTION.md).
The external Obsidian control center is outside this task.

## Run

Start the existing native services with `YTT-Start.bat`. Build current frontend
with `npm run build` before profiling code changes. Close other QA clients and
avoid editing this fixture during the run: reset overwrites its prepared state.

```powershell
node scripts/qa/tech02-soak.cjs --rounds=10
# Future separate task ONLY, after explicit authorization:
node scripts/qa/tech02-soak.cjs --full --rounds=50
```

Default is 10 rounds; more than 12 requires `--full` (limit 100). The script checks
APP_ENV=local, uses localhost:8090 only, resets via `php artisan qa:townhouse`
before starting and in finally after closing browsers. Never uses --install,
creates accounts/campaigns/scenes/sessions, changes passwords or exports storage
state. Accounts are read directly from the existing ignored private file.
If forcibly killed, restore manually with `php artisan qa:townhouse`.

Uses the same installed Playwright/Chrome as TECH-01; no npm dependency added.
`YTT_PLAYWRIGHT_MODULE` may specify the absolute path of an existing Playwright
module if the bundled runtime moves; `YTT_PHP` may specify a PHP executable.
A nonzero exit means failed assertions, operational error or restoration failure.
See the dated ignored `artifacts/tech02/<UTC timestamp>/report.json`.

## Fixed workload: townhouse-v1

Three isolated browser contexts, 1440×1000, physical dice enabled. Warm inventory
portals before baseline. Position existing heroes near an existing visible NPC.
Start the prepared six-combatant encounter. For each full round:

1. Advance every combatant exactly once with expected round/current combatant
   guards. NPC turns deliberately pass; this is a session workload, not an AI fight.
2. On each Player turn: move one grid step (alternating positions), execute the
   equipped weapon or an existing attack cantrip through the Player HUD targeting
   and physical dice presentation, wait for settlement, close the action.
3. GM revives/restores the same target before each Player action so random hits
   cannot exhaust the fixture. Corrections are a fixed part of the workload.
4. Every fifth round open/close both inventories. Add/remove one public poisoned
   condition each round. No loot transfer or scarce spell slots are consumed.
5. Compare each Player's actual frontend state with its own authorized server
   snapshot. Random rolls/results vary; command mix and cadence remain fixed.

Commands use existing APIs; action/dice/window presentation uses real React UI.
Movement uses the real player command endpoint, not mouse dragging on every turn.
The read-only React-owner bridge is intentionally QA-local and build-sensitive;
if it fails, repair the harness, not production components.

## Checkpoints and correctness

Baseline, rounds 10/25/50, requested final round (50+ supported), after reconnect,
and final idle/cleanup (end combat, close action/windows, idle 3 seconds). All
checkpoints compare authorized projections, then request Chrome GC and record:

- Exact JS heap bytes, reachable DOM nodes/documents/listeners via CDP.
- Live tabletop canvas count, Pixi stage display-object count, dice initialization
  count where present. These are object counts, not GPU memory estimates.
- Bounded rAF samples: sample count, p95 interval, count above 50ms. Headless Chrome
  scheduling and active/idle workload affect these; they are not GPU timings.
- Bounded API request latency samples by route (Playwright responseEnd, ms).
- Active WebSocket channel sets, subscribe attempts/repeated active subscriptions,
  and accepted mutation event counts/duplicates (512 recent IDs retained).

No reliable per-client GPU memory or detached-node count is claimed. No raw heap
snapshot, credential, cookie, request body or full scene payload is saved.
Diagnostic frames/latencies are bounded and drained; event IDs are cleared after
each checked round, so instrumentation does not retain a full long session.

For every accepted next-turn command, require its mutationId on GM and both
connected Players, plus the resulting Pixi revision on both Players. Detect
duplicates by channel + mutationId + revision. Control events without mutationId
are not conflated: repeated activations have distinct liveRevision values.
Player snapshots are compared with Player frontend state (combat, revision,
positions, visible HP/conditions, own Character HP/selection); never with secret
GM DTOs. Failure is missing event/update, duplicate mutation delivery, desync,
multiple HUD/tabletop canvases, uncaught JS errors, failed action or failed restore.
Heap/latency trends are findings, not arbitrary pass/fail millisecond thresholds.

## Reconnect

Halfway through the requested run, set Player 1 HTTP offline AND disconnect its
actual Pusher transport. Chrome offline alone leaves existing WebSockets open.
While disconnected, GM changes HP and Player 2 continues reading the scene.
Restore network, reconnect the same transport, require the connected badge and
exact Player state restoration without reload, capture checkpoint, then continue
normal rounds/actions. No channel or production lifecycle is patched.

## Full-task request

“Run TECH-02 using docs/TECH02_SOAK_PLAN.md and the townhouse-v1 harness for 50+
rounds. Review memory/performance trends and correctness, record findings,
restore the fixture, and do not expand into unrelated fixes.”

## Preflight evidence (2026-10-31)

The 10-round smoke passed and restored the fixture. Report:
`artifacts/tech02/2026-10-30T22-44-40-141Z/report.json` (UTC directory date).
Both Players executed ten actions each; all 60 turn deliveries and authorized
state comparisons passed. Channels remained GM 4 / each Player 5 after reconnect.
Frontend suite: 46 files / 212 tests; standalone harness syntax and ESLint pass.

Findings for the future full run, not preflight blockers: post-GC Player heap
was 11.25/11.38 MB at baseline, 13.68/14.05 MB after round-5 reconnect, and
14.23/14.61 MB at round 10. Physical dice lazy initialization and normal combat
history are included. Player DOM at rounds 5 and 10 was stable (812 / 864);
listeners 435→436 and 449→449; final combat cleanup reduced nodes to 659 / 679.
GM combat UI counts also fell after ending combat. Do not infer a universal
heap plateau or diagnose a new leak from these short-run totals. No unrelated
application fixes or external-roadmap edits were made.

A separate verification attempt stopped after round 5 with `Failed to fetch`;
its fixture restoration passed. No retry hid the failure. It is retained in
`artifacts/tech02/2026-10-30T22-48-48-078Z/report.json` as an operational finding,
not attributed to a product root cause. The final harness records `lastCommand`
(role/route/method) to make a recurrence actionable.

The final diagnostic repeat completed 8 rounds successfully, including reconnect,
round-8 and final-idle checkpoints, with zero duplicate mutation deliveries or
repeated active subscriptions. Deterministic restoration passed again. Report:
`artifacts/tech02/2026-10-30T22-51-55-766Z/report.json`. The single fetch failure
did not recur in the same three-role workload; classify it as a flaky/transient
finding for full TECH-02. Its original route/role was not captured, so an exact
route-specific reproduction or root cause is not claimed. No automatic retries
were added. The successful 10-round run remains the preflight baseline.
