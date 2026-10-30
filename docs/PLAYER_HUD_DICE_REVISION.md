> Historical validation used the former container runtime. Current local commands: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md); data migration: [LOCAL_MIGRATION.md](LOCAL_MIGRATION.md).

# Player HUD / dice revision — 2026-10-30

## Composition reference and plan

Primary reference: local BG3 `hotbar.png`. The portrait silhouette protrudes above
its own small plinth; the action belt is a distinct central shape, with a compact
resource shelf above it. Transparent notches/gaps separate the modules. YTT keeps
one row of twelve slots; phone widths scroll that same belt instead of stacking it.
The party selector becomes a vertical portrait stack beside the active portrait.
No enclosing HUD card. Names/HP stay with the portrait; resource state stays with
the actions. The local folder contains a blue-die close-up and damage dice detail,
but no full-screen check composition; use those for physical material/number scale
and the requested centered title/DC → large stage → modifier/result hierarchy.

## Baseline profile (before changes)

Chromium, 1440 × 1000, local Docker, real Player checks with the Pixi map mounted.
Observed display rAF cadence is ~120 Hz. Module was cached for the measured runs.

| Probe | One d20 | Advantage (two d20) |
| --- | ---: | ---: |
| Three render interval p50 / p95 | 8.3 / 8.6 ms | 8.3 / 8.8 ms |
| Largest observed render interval | 72.3 ms | 54.9 ms |
| Separate first-open main-thread long task | 239 ms | 88 ms |
| DiceBox initialize | 40.4 ms | 15.6 ms |
| Synchronous pre-simulation | 11.0 ms | 6.8 ms |
| Stage | 354 × 230 px | 354 × 230 px |

Actual causes found in source and live probes:

- Every roll constructs/initializes a new DiceBox and Three renderer; damage mounts
  a second renderer. Shader/context startup is paid repeatedly, not just once.
- ResizeObserver calls `setDimensions()` again during the live throw. Both canvas
  width/height are reassigned; world/camera/lights/desk are rebuilt. The initial
  explicit dimensions and subsequent no-argument dimensions use different scales.
- A result-time camera fit changes the framing abruptly after motion stops.
- The library renders at display cadence but steps physics in whole 60 Hz chunks,
  copying discrete poses without interpolation. No React state is updated per frame.
- A 1024px shadow map and a blurred modal backdrop add GPU work while Pixi remains
  active. DPR is ~1 in this probe, so excessive DPR was not this run's cause.
- No evidence of multiple persistent dice loops; the independent Pixi loop remains.
  Ordinary steady-state p95 was already good; startup spikes, live resize and small
  travel space are the issues to fix rather than claiming generally low FPS.

Retain dice-box-threejs: its meshes, Cannon bodies and forced faces are useful.
Use one lazy Player-owned renderer, a stable large stage, one interpolated rAF loop,
bounded physics catch-up, deferred resize and cheaper adaptive dice-only quality.
Keep server dice, face verification/remapping, reduced-motion and failure fallback.

## Foreground profile after integration changes

Same desktop viewport, Pixi scene mounted, real server checks, display ~120 Hz.
Two runs per mode, sampled from **actual Three render calls during the physical
throw**, not just an unrelated rAF observer. Warm-up was completed before motion.

| Mode | Samples (two runs) | p50 | p95 | Largest frame | Frames >50ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| One d20 | 798 | 8.3 ms | 8.6 ms | 9.8 ms | 0 |
| Advantage / two d20 | 926 | 8.3 ms | 8.6 ms | 9.7 ms | 0 |

No main-thread long tasks in these four rolls; pre-simulation took 1.0–4.7 ms.
One DiceBox initialization was retained across eight consecutive checks (including
four discarded background-tab probes). Warm-up had one 91 ms task, paid once before
motion rather than on each roll. Active stage is **1240 × 590 px**, versus 354 × 230.
Initial parking → dialog resize happens before rolling; subsequent throws use the
same dimensions. Three contexts/canvas are retained through result/damage phases.
The resting group is gently centered over 240ms, without snapping or resizing.

Background-tab probes produced ~1 FPS because Chromium throttled the hidden tab;
they are explicitly excluded. Foreground runs called `bringToFront()` and verified
`document.visibilityState === 'visible'`. These are local Chromium observations,
not a guarantee for every GPU/browser. Steady-state p95 was already fast before;
the improvements are removal of repeat startup stalls/live resize and interpolated
poses, plus enough physical travel space.

Quality is dice-only: DPR capped at 1.5 (1 for coarse/low-core devices), 512px
shadows on balanced quality, shadows off on economy quality, bounded physics catch-up
and fewer solver iterations. Pixi quality and its renderer are unchanged.

## Acceptance and regression checks

This revision supersedes the Task 20 HUD/dice composition and framing described in
`PLAYER_UI_ART_DIRECTION.md` / `PLAYER_UI_VALIDATION.md`; the earlier mechanics and
backend verification are not repeated or claimed as new work here.

- 1920 × 1080 and 1440 × 1000: one 62px action row, portrait separated by an open
  gap, a raised resource shelf, no enclosing rectangle. The main HUD bounding box
  is ~115px tall. HP remains on the portrait; resources remain with the belt.
- 390 × 844 touch emulation: ~78px main HUD plus ~18px resource shelf (~96px total),
  48px slots in the same scrolling row, no document overflow. A quick 180px swipe
  scrolls ~181px and executes nothing. CSS scroll snap was removed because it fought
  incremental finger movement. A subsequent mouse click on this hybrid input setup
  still opens the intended action. Hold/drag swaps slots, reverse swap restores them,
  and the restored arrangement survives reload without executing an ability.
- Character selection uses a compact vertical portrait stack. Switching to Mira's
  independent empty belt and back restores Kern's twelve slots. Single-character
  rendering has no stack marks or switch affordance.
- Real ranged attack → d8 damage: one renderer initialization, one canvas, three
  cumulative presentations including the preceding check, no stage resize between
  d20 and d8. Physical d8 showed the server face **3**, damage **5**. QA target 302's
  current pre-test **77 HP** was restored via the authenticated GM API (200 response).
- Reduced motion: zero renderer initializations, static server result, enabled
  Continue, exactly one execute request, no page errors. A separate test returned
  null from WebGL context creation only for dice, leaving Pixi mounted; it reached
  the same intentional result fallback with one command and no page errors.
- Full ESLint and **21 relevant tests / 6 files** pass in the disposable Docker
  frontend container. The tests cover graphics ownership, deferred resize,
  cancellation, authoritative notation, ability geometry/affordability, and acting
  character/check request regressions. `tsc --noEmit` and Vite production build pass;
  the updated local Docker environment starts healthy. No backend source changes.

Screenshots were visually inspected beside the local reference, with a composite
saved as `artifacts/task21-bg3-comparison.png`. It confirms the separate portrait
silhouette, central action hierarchy and resource shelf; YTT intentionally uses one
action row rather than BG3's many-row inventory-like belt. No BG3 pixels ship in UI.
Phone/browser emulation is not physical-device or Safari/Firefox verification.

Evidence (ignored local `artifacts/`):

- `task21-hud-1920.png`, `task21-hud-1440.png`, `task21-hud-390.png`
- `task21-character-switcher.png`, `task21-hotbar-costs.png`
- `task21-dice-before.png`, `task21-dice-motion.png`, `task21-dice-result.png`
- `task21-dice-advantage.png`, `task21-dice-390.png`, `task21-dice-fallback.png`
- `task21-hud-390-scrolled.png`, `task21-party-390.png`
