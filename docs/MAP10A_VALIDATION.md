# MAP-10A — architecture and validation

2026-11-05. Local native runtime, Chromium 156, GM + two existing Players in
separate browser contexts. No new accounts, campaigns, scenes or sessions.

## Architecture

- Scene ambient brightness/color and day/night presets; up to 16 local sources
  with radius, color, intensity, falloff and optional Token attachment. GM-only
  authoring uses existing scene authorization, idempotency and conflict handling.
- `StructuralGeometry` supplies independent `blocksLight` blockers, including
  transformed prop colliders, open/closed doors and configurable windows.
  Existing LOS/Player Vision authority is unchanged.
- Shadow work is a coalesced MySQL `tabletop` job on queue `lighting`. The native
  launcher and supplied systemd worker use `cues,lighting`, with Cue priority.
  Movement only schedules work; it does not wait for polygons, rasterization or
  lighting DTOs. Jobs read latest committed state without scene writer locks.
- Recipient-specific `lighting.frame` events do not advance Scene revisions,
  touch SaveQueue, reset routes, or notify React subscribers. Initial/reconnect
  reads hydrate visual state. Late/foreign frames cannot restore revoked light.
- Players receive compact raster masks clipped server-side to current visibility,
  never hidden emitters, raw blockers, topology or unseen shadow polygons. Unseen
  public emitters contribute only an anonymous RGB irradiance field within current
  visibility, without their ID, position or parameters. GM-hidden emitters contribute
  no pixels. Native async inflate hydrates one reusable additional texture. The
  Pixi composite also clips against the exact current mask. Fog v2 and Manual Fog
  remain above lighting. Light does not grant visibility, targeting or combat rules.
- GPU additive colored falloff within each emitter's footprint feeds a persistent lightmap, then a multiply
  composite. Lightmap longest side ≤1024; mask longest side ≤384. Bilinear mask
  edges are soft; this is not physical area-light penumbra. Idle/camera frames do
  no lighting offscreen work. Token playback supplies the radial center directly.
  A bounded pool reuses up to 16 emitter resources; disabled scenes allocate no
  light shader or render target.

## Benchmark

Same Scene 7 and protocol as MAP-09.1: 1680×1050, three roles, zoom 29/50/100%,
2.6-second held WASD plus settling, 800-unit Click-to-Move. Five lights, including
one moving torch. Screenshots/readback run separately. Submission CPU time is
reported separately from browser frame time; it is not a GPU timer query. The
paired runs used WebGL through ANGLE/D3D11 on a GeForce RTX 4070.

Player 1 aggregate across all three zooms:

| Input / phase         |   FPS | Frame p95 / p99, ms | HTTP p50 / p95, ms | Distance in window |
| --------------------- | ----: | ------------------: | -----------------: | -----------------: |
| WASD · MAP-09.1       | 115.9 |         10.2 / 11.2 |      215.0 / 277.0 |              401.5 |
| WASD · fresh control  | 113.8 |         10.6 / 13.5 |      212.8 / 267.2 |              391.3 |
| WASD · Lighting       | 113.4 |         10.5 / 13.3 |      216.6 / 316.4 |              390.8 |
| Click · MAP-09.1      |  74.8 |         15.9 / 16.8 |      210.0 / 250.9 |              798.8 |
| Click · fresh control |  71.7 |         16.5 / 17.5 |      215.3 / 369.2 |              787.3 |
| Click · Lighting      |  75.1 |         16.3 / 17.5 |      208.9 / 264.5 |              786.3 |

GM with Lighting: 113.9 FPS / frame p95 10.3 ms (WASD), 75.2 FPS / 16.4 ms
(Click). Player 2: 113.5 FPS / 10.5 ms, 75.1 FPS / 16.3 ms. Every role has zero
backsteps and zero movement resets. All three long routes complete. WASD max
frame position step is approximately 3 units, matching MAP-09.1. Light center error
is <0.00013 world units: Float32 rounding, with no independent light tween/jitter.

Light pass submission p95 is 0.2 ms. No per-step render-target allocations.
Player 1 allocates one mask when a previously unseen static source enters view;
subsequent cases reuse it. GM/Player 2 have zero in-window allocations. No Fog
memory allocations. No per-step lighting HTTP requests, and no lighting polygon
or raster work in movement HTTP spans. JS errors: zero. Fixture restored: true.

Against the paired control, Player 1 WASD FPS and distance differ by less than 1%;
Click frame p95 is 0.2 ms lower. One 800-unit route finishes just after the
measurement window, and all routes finish without resets. Frame/HTTP tails are
shown explicitly above.
This is evidence for this machine and fixture, not a guarantee for arbitrary maps.

Reproduce with the commands in [TEST_PLAYGROUND.md](TEST_PLAYGROUND.md).
Full per-role traces and machine-readable results:
`artifacts/map10a/performance.md`, `performance.json`,
`artifacts/vision-motion/{final-verified,map10a-control-clean,map10a-final}/`.
Earlier contaminated diagnostic runs are excluded: an owned browser left by an
early failed restore was closed before both clean comparison runs.

## Validation and evidence

- Full PHP suite: **403 passed, 12,505 assertions**. After isolating lighting
  enqueue failures from committed commands: focused PHP regression **32 passed,
  7,139 assertions**.
- Full Vitest suite: **351 passed / 70 files**. Includes independent visual-stream
  revision handling, stale frames, snapshot reset, RLE, native async inflate and
  existing movement tests.
- `npm run build`: passed. `npm run lint`: passed. Native nullable JSON migration
  applied successfully; no destructive data operation.
- Real Chrome acceptance: GM + two Players; day/night, multiple colored torches,
  door, independent light-blocking window, anonymous RGB spill through a
  vision-only window, hidden-data filtering, current/explored
  Fog and Manual Fog, both Players using WASD, long Click-to-Move and GM editor
  creation/binding/radius/save. GPU pixel and idle counter checks pass.
- Screenshots: `artifacts/map10a/townhouse-{day,night}-{gm,player1,player2}.png`,
  `gm-lighting-editor.png`, `playground-night-player{1,2}.png`; acceptance report
  `artifacts/map10a/report.json`. Settings, tokens, graph, active scene and Fog
  restored. QA browsers close even if restoration throws.

Non-failing tool output: Vitest's AbortSignal listener warnings; Vite's existing
divider-image resolution and large-chunk warnings. No runtime WebGL/JS errors.

MAP-10B, Darkvision, light-dependent visibility/targeting and MAP-07E.2 remain
outside this implementation. Public light can spill through a vision-only blocker without disclosing an emitter
definition. GM-hidden emitters remain excluded. Shadow refresh can lag
behind accepted state when the queue is busy; visual Token movement never waits.
