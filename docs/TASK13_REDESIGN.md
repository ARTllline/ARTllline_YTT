# Task 13 — Full VTT Workspace & Live UX Redesign

Implemented and checked locally on 2026-10-29, from `93899cf`.
The existing Laravel/API/domain/realtime contracts are preserved. No migrations,
dependency changes, environment edits, production rollout or commit/push.

## UX Problems Found

The previous default layout competed with the table: preparation, properties and
floating combat could occupy the screen together. The header mixed navigation,
preparation and live actions. Empty properties and expanded secondary controls
consumed attention before the GM selected anything. Live session mode still exposed
editor controls, while audio and handouts had separate launch/overlay patterns.

Browser testing also found a redesign-specific interaction hazard: opening the
Inspector on pointer-down resized the canvas and cancelled the first drag. Selection
now changes panel geometry after the gesture finishes. Three regression tests cover
release, cancellation and cleanup; a real GM drag was verified on a connected Player.

## New Information Architecture

| Mode       | Primary purpose                                      | Panel behavior                             |
| ---------- | ---------------------------------------------------- | ------------------------------------------ |
| Стол       | Play and improvise on the map                        | No empty side panels; contextual selection |
| Подготовка | Scenes, media, prefabs, encounters, cues, automation | One left workspace                         |
| Сессия     | Current beat, next/previous, notes, preload          | Live plan; one optional right dock         |
| Библиотека | Find, preview, upload and place media                | Asset workspace                            |

Settings remain at the bottom of the rail. Combat, cues, handouts, audio, players
and triggers share the lower live launcher and a single right dock. Explicit panels
replace the Inspector; closing them returns to the selected object. Escape respects
text inputs and dialogs. Desktop can show the live plan and one live dock together;
tablet dock actions replace the plan drawer after its notes have saved.

## Design System

Graphite surfaces (`#111215`, `#1b1d22`, `#24272e`), readable light text (`#e8e9ed`),
muted text (`#a1a5b0`), restrained mint (`#a3d8c1`), amber combat (`#dfbd7b`) and
violet director/GM accents (`#b9a5dc`). Segoe UI/system typography; shared 4/8/12/16/
24/32/48 spacing scale, compact controls and 5/9/14 radii. Borders separate surfaces
without outlining every card. Visible keyboard focus, labelled icons/native tooltips,
accessible dialog titles and reduced-motion rules remain available.

## Workspace

The map owns the center. A 68px navigation rail, 56px header and floating spatial
tools replace the previous permanent panel arrangement. The default left workspace
is 332px and the dock 336px. The left workspace supports bounded native resizing on
desktop. Selection editing groups identity, HP/state, access, position, transform,
image and snapping into disclosures. Combat replaces properties, shows a clear
current turn and exposes details for the expanded participant.

The same Pixi canvas, camera, SceneStore and SaveQueue survive panel/mode changes.
Pan, zoom, fog, ruler, area templates, pings, contextual selection and existing
keyboard shortcuts remain on their established implementation paths.

## Preparation UX

Scenes have search, current/active status and a preview for the loaded map. The
object outline is collapsed initially. Assets retain categories, tags, collections,
search, upload, previews and direct drag onto the table. Prefabs and encounters use
the existing reusable-content workflows. Cues have searchable cards; their editor
uses the same charcoal surfaces with a violet selected step. Automation opens in the
shared dock, and region controls no longer duplicate a floating preparation panel.

## Session UX

The current beat and its explicit action lead the session plan. Next/previous only
move plan focus. GM notes and preload details are collapsed; note autosave flushes
before leaving the mode. Grid/setup/history buttons recede from the live toolbar.
Combat, sound, handouts, players and triggers remain one-action dock destinations.
The players panel includes owned token names and available preload state.

Audio failures keep their exact retry UUID and prevent accidental panel replacement.
The real failure/retry path was exercised. Player handout presentation was checked
in a separate logged-in browser context. Phone initiative starts collapsed to the
round and current turn, with the participant list one tap away.

## Command Palette

Ctrl/Cmd+K opens a 640px maximum-width searchable palette. It finds scenes, cues,
encounters, handouts, media and active-session items through existing APIs. Actions:
activate scene, start cue, place encounter, show handout, open asset details, start/
stop music, toggle rain/snow/embers/haze, focus a session beat and open live panels.
Arrow keys and Enter work; Escape closes. Search is debounced and aborts superseded
queries. Results are bounded to 40 per resource type; narrower queries find additional
matches. Cue launch requires its scene to be active. Session focus never runs actions.

## Responsive

The 1920×1080 and 1440×1000 layouts keep the table dominant. At 768×1024, side panels
become drawers and live controls remain available. At 390×844 the Player header wraps
its few controls and the compact initiative header stays clear of the map. All 13
required captures have one canvas and no document-level horizontal overflow.
The phone is a Player target; full GM authoring remains a desktop/tablet workflow.

## Performance

Same local Chromium, 1440×1000, campaign 12/scene 39, warm-up 1.8s and 240 animation
frames: 4096px map, 200 props, 36 tokens, 1200 fog actions, two textures, 2048² fog mask.

| Metric              | Previous default UI | New default UI |
| ------------------- | ------------------: | -------------: |
| DOM elements        |                1836 |            301 |
| rAF p50             |               8.3ms |          8.3ms |
| rAF p95             |               8.4ms |          8.5ms |
| rAF maximum         |               8.5ms |          8.5ms |
| Canvases / textures |               1 / 2 |          1 / 2 |

Sixteen dock transitions plus pan/zoom retained the identical canvas node and two
textures. These short headless timing samples show no material change in frame
cadence; they are not a GPU benchmark or a multi-hour memory-leak/real-device test.
The DOM reduction compares the old and new defaults, not identical sets of open panels.
Final main JS: 282.68kB / 88.97kB gzip; GM workspace: 56.48 / 17.03; renderer:
325.46 / 101.17. Main CSS is 79.75 / 16.56 (previous CSS was about 60kB uncompressed).
Palette, session, asset, cue, audio and automation editors retain lazy loading.

## Validation

- `composer test`: 89 tests, 1169 assertions.
- `npm run test`: 119 tests in 23 files; six workspace state tests and three gesture
  layout regression tests added.
- `npm run typecheck`, `npm run lint`, `npm run build`, `php vendor/bin/pint --test`,
  `git diff --check`: passed.
- Chromium 156.0.8078.74: 13 required screenshots, zero page errors, no horizontal
  overflow; reduced-motion disables panel animation; palette width checked at 640px.
- Real GM/Player contexts: pointer drag → authoritative persistence → Reverb delivery;
  Undo restores movement; native asset-to-canvas drag creates a prop; palette music,
  atmosphere, handout, encounter and scene commands work. Cue completed all three
  steps through the actual queue. Fog brush, ruler and ping were also exercised.
- Audio transport failure: panel remains mounted, retry uses the original UUID.
  Session notes survive immediate mode switching. Player snapshot excludes hidden
  token “Тень под маяком”; Player has no GM navigation.

Writes were isolated to QA campaign 13, “Последний маяк · QA13”, scenes 40–42.
Existing heavy scene 39 was read/visually exercised without changing its scene data.
Raw scripts, logs, fixture identifiers and JSON reports remain in ignored
`artifacts/task13-*`. Fixture content was authored through existing APIs; screenshots
are real application captures, not mocked interfaces. Pint initially found a format
issue in the old ignored `artifacts/task04-large-map.php`; only that helper's formatting
was corrected, then the full check passed. Sandbox Vite realpath/local-network checks
required approved execution outside the restricted shell.

## Screenshots

| Size      | Required state             | Capture                                         |
| --------- | -------------------------- | ----------------------------------------------- |
| 1920×1080 | Clean workspace            | [Open](../artifacts/task13-1920-clean.png)      |
| 1920×1080 | Scene browser              | [Open](../artifacts/task13-1920-scenes.png)     |
| 1920×1080 | Selected token / Inspector | [Open](../artifacts/task13-1920-inspector.png)  |
| 1920×1080 | Combat dock                | [Open](../artifacts/task13-1920-combat.png)     |
| 1920×1080 | Asset library              | [Open](../artifacts/task13-1920-assets.png)     |
| 1920×1080 | Cue editor                 | [Open](../artifacts/task13-1920-cue-editor.png) |
| 1920×1080 | Session mode               | [Open](../artifacts/task13-1920-session.png)    |
| 1440×1000 | Clean workspace            | [Open](../artifacts/task13-1440-clean.png)      |
| 1440×1000 | Combat dock                | [Open](../artifacts/task13-1440-combat.png)     |
| 1440×1000 | Session mode               | [Open](../artifacts/task13-1440-session.png)    |
| 768×1024  | GM workspace               | [Open](../artifacts/task13-768-gm.png)          |
| 768×1024  | Session mode               | [Open](../artifacts/task13-768-session.png)     |
| 390×844   | Player                     | [Open](../artifacts/task13-390-player.png)      |

Additional evidence: [before](../artifacts/task13-before.png),
[palette](../artifacts/task13-chromium-palette.png),
[heavy scene](../artifacts/task13-heavy.png),
[audio](../artifacts/task13-extra-audio.png).

The original battle map was generated with the built-in image-generation tool and
uploaded as a QA asset. Saved copy: `artifacts/task13-lighthouse-map.png`.
Prompt: “Use case: stylized-concept. Asset type: original QA battle map for a local
browser virtual tabletop, not a UI mockup. Create a beautiful detailed top-down
orthographic RPG battle map of a ruined lighthouse island at dusk. Landscape 3:2
composition. Rocky slate coast, weathered circular lighthouse foundation on the upper
right, stone stairs and a wide ruined courtyard connected to a wooden jetty in lower
left, two roofless small rooms with masonry walls and crates. Clear large traversable
areas for tabletop tokens. Deep desaturated navy sea with pale surf, cool gray stone,
muted moss, a few small warm lantern lights. Sophisticated hand-painted cartographic
game environment with natural texture, readable tactical geography. No people, no
creatures, no tokens, no grid, no text, no labels, no interface, no decorative frame.
Entire image is playable terrain seen exactly from above.”

## Remaining UX Concerns

- Inactive-scene thumbnails need a bounded metadata endpoint; numbered placeholders
  avoid fetching full scene snapshots merely to decorate a list.
- Native left-panel resizing is basic and not saved between visits. Fully dockable
  panels and persistent widths remain future work.
- Resizing a desktop live layout to tablet hides, but retains, an open session plan
  until it is explicitly closed/replaced, preserving its pending notes.
- Undo coverage remains the existing bounded layout-edit subset. Creating/deleting
  content, combat, audio and cue execution are not reversible through Undo.
- Existing feature styles remain underneath the new presentation layer. Future UI
  work should use shared tokens/components and reduce old overrides when touched.
- Firefox could not start because its Playwright binary is absent. Firefox, Safari,
  physical touch devices, external WSS and a multi-hour session were not verified in
  this task; previous milestone evidence does not certify this redesign on them.
