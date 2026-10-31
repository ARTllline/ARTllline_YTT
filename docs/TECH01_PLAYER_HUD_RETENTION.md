# TECH-01 — Player HUD memory retention

Validated locally on 2026-10-31, using native PHP/MySQL/Reverb and the existing
Townhouse campaign/scene 5, session 1, and three isolated account contexts.
No new accounts, campaigns, scenes or sessions were created.
After all browser checks, `php artisan qa:townhouse` restored the existing
fixture to its prepared state (campaign 5, scene 5, prepared combat 37).

## Confirmed causes and fixes

1. `CharacterHUD` gave both the identity/HP div and its sibling `AdventuringHUD`
   the Character ID as their React key when no rest existed. Reconciliation of
   these duplicate sibling keys left old identity DOM connected to the document.
   Their button handlers, props and React closures therefore remained reachable.
   This was not a missing WebSocket unsubscribe or an idle dice renderer.
   Identity now has a stable local key; the rest boundary has an `adventuring:`
   namespace. The parent still remounts `CharacterHUD` on Character changes and
   the adventuring boundary still resets on rest changes.
2. After fixing the first cause, opening/closing RPG windows exposed a separate,
   bounded retainer: Pixi's federated pointer event pool and root pointer event
   retained `nativeEvent` / its DOM event path, including closed window subtrees.
   Heap paths led from the document listener to `EventSystem`, `rootBoundary`,
   `eventPool`, `FederatedPointerEvent.nativeEvent`, and a detached RPG section.
   YTT uses `PointerController` DOM listeners for input and has no federated Pixi
   pointer handlers. `Application.init` now disables the unused federated move,
   globalMove, click and wheel features through Pixi's supported options. This
   prevents acquiring those native-event references; it does not periodically
   clear pools, patch library internals, or force production garbage collection.

## Before/after evidence

Chrome headless, 1440 × 1000, reduced motion for the turn scenario. Same built
application and deterministic fixture, 72 turn advances (12 rounds), samples at
0/24/48/72. Diagnostic buffers cleared and CDP garbage collection requested before
each sample. `Memory.getDOMCounters` includes reachable DOM outside the live tree;
heap is `Runtime.getHeapUsage.usedSize`, in decimal MB.

| Player | Before: HUD count | Before: DOM nodes | Before: listeners | Before: heap MB | Fixed: HUD | Fixed: nodes/listeners at every sample | Fixed: heap MB |
| ------ | ----------------- | ----------------- | ----------------- | --------------- | ---------- | -------------------------------------- | -------------- |
| Kern   | 11 → 89           | 925 → 2875        | 329 → 641         | 9.29 → 14.77    | 1          | 695 / 289                              | 8.93 → 9.74    |
| Lyra   | 11 → 87           | 971 → 2871        | 343 → 647         | 9.59 → 18.94    | 1          | 741 / 303                              | 9.03 → 10.00   |

The initial baseline already had duplicates from initial hydration. Live element
counts grew as well: these HUDs were connected, not merely detached elements
waiting for GC. The Lyra heap snapshot contained 87 identity blocks before and
one after; native detached element counts were unchanged (16) in this turn flow.
One tabletop canvas remained throughout.
The growing counts matched exactly 25 DOM nodes and four listeners per extra
identity block (for example Kern: 78 extra blocks, 1950 nodes, 312 listeners).

Independent closed-window experiment, after the key fix: at 10/20/30 cycles,
Kern retained 2005 nodes / 532 listeners, with only 473 live elements. With Pixi
features disabled, the identical series retained 695 nodes / 432 listeners at
all three checkpoints, still 473 live elements. The initial increase from 289
to 432 listeners is React's one-time delegated event registration on the portal
container; it does not repeat with subsequent windows or scene remounts.

## Regression protection and validation

- `PlayerGameplayHUD.test.tsx` renders the real conditional HUD child list and
  checks unique sibling keys across Character IDs, combat updates and absent,
  same-ID and different-ID rests. It fails on the original code (`5, 5`) and
  passes with the fix. It is a reconciliation identity test, not a simulated
  claim that all browser memory leaks are impossible.
- `TabletopRenderer.test.ts` captures the actual renderer initialization options
  and applies them to the real Pixi `EventSystem`. Ten pointer/wheel cycles must
  reach the independent DOM input handler without entering Pixi's event pool or
  retaining a native pointer event. Restoring the old options fails the test.
- Frontend: 46 files / 212 tests passed, including SceneSubscriber teardown,
  dice lifecycle, combat and state tests. Build, TypeScript and lint passed.
- Backend: 145 relevant tests / 2365 assertions passed using isolated SQLite
  (`Combat|Character|Realtime|Inventory|Adventuring|Spell` filter).
- Browser: 10 inventory/Character window cycles, 10 actual Character
  unmount/remount cycles, three scene epoch remounts, and 10 targeting
  start/cancel cycles leave one HUD per Player and stable DOM/listener counts
  after portal initialization.
- Three actual weapon attacks completed with five settled physical dice
  animations (attack/damage), one initialization and one reusable dice canvas.
  Three explicit Pusher disconnect/connect cycles, combined with HTTP offline
  emulation, recovered authoritative HP changes without reloading. Merely
  setting Chrome offline was insufficient: it kept the existing WebSocket open.
  Subsequent turn events reached both Players with zero duplicate tabletop
  events (nine observed per client in that reconnect check).
- Final combined run: three scene epoch remounts, three transport reconnects,
  then next-turn events on both Players, with zero duplicate accepted scene
  mutations. Campaign control notifications use `liveRevision`, not a mutation
  ID, and are not collapsed into one fake duplicate key across activations.
  Actual Player token dragging persisted and reached the GM renderer; wheel
  zoom and Space-drag pan also passed, with one tabletop canvas.

## Files changed

- `resources/js/gameplay/PlayerGameplayHUD.tsx` — distinct sibling identities.
- `resources/js/gameplay/PlayerGameplayHUD.test.tsx` — identity regression guard.
- `resources/js/tabletop/renderer/TabletopRenderer.ts` — input ownership options.
- `resources/js/tabletop/renderer/TabletopRenderer.test.ts` — real EventSystem guard.
- `AGENTS.md` — external control center usage policy.
- This report — reproduction, evidence and verification limits.

The build retains its existing warnings about the decorative divider URL and
the large dice chunk; neither was expanded into this task.

Ignored local profiling harnesses and numeric evidence are in `artifacts/tech01/`.
Raw heap snapshots were reduced to sanitized retainer paths/counts and removed:
they can contain session/application data. No production profiling hook or new dependency
was introduced. The external Obsidian Development Control Center was neither
read nor edited; only its usage policy was added to `AGENTS.md`.

## Limits and next task

Short-run heap still increases modestly during warm-up and normal state/history
activity; these results establish removal of the two concrete DOM retainers,
not a universal heap plateau. Long-duration GPU/heap behavior, WAN and other
browsers remain outside this task. TECH-02 (50+ round multiplayer soak) is a
separate follow-up and was not started here.
