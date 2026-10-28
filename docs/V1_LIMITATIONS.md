# V1 operating limits

This is a first-session candidate, not a guarantee for every browser, GPU or VPS.
Use the release checklist before inviting players. Task 12 evidence and unresolved
environment checks are recorded in VALIDATION.md.

## Editing and recovery

- Undo/redo is GM-only, local to the current scene/tab, bounded to 50 acknowledged
  edits. It supports token/group movement, prop position/rotation/scale, note movement
  and edits to existing regions. Reload, scene hydration/switch and unsafe concurrent
  changes clear history. It is not durable offline storage.
- Creation, deletion, duplication, map/grid/fog changes, note text, HP/conditions,
  combat, Cue/Trigger execution, audio, handout access, Session and activation have
  no Undo in V1. An inverse movement does not reverse or retrigger live actions.
- The server compares affected fields before applying an inverse atomically. A
  missing/locked/concurrently edited object rejects it and resynchronizes the scene.
  A lost response retains the command UUID for Retry. Do not clear browser storage
  or close a tab with unconfirmed edits; use Retry or explicitly load saved state.
- Ordinary forward edits remain last accepted write wins. Scene revision orders
  updates; it is not a global optimistic-lock requirement on every command.
- Pending browser edits are memory-only. Receipt retry protection defaults to seven
  days; after that, inspect authoritative state before manually repeating an action.

## Privacy and media

- Hidden entities, GM notes/regions, triggers, Cue definitions and Session plans are
  filtered on the server. Manual fog is visual concealment, not individual LOS.
- Handouts can be shown to all current players or selected campaign players and
  revoked from all/selected players. Revocation closes the viewer and denies future
  private-file requests. A disconnected client catches up on reconnect/polling.
  Files already downloaded, screenshots and browser-owned copies cannot be erased.
- Explicit preloading discloses authorized resource bytes before activation. The GM
  confirmation in the panel is meaningful; this is not encryption of future content.
- Browser audio needs a user gesture. Device mute, codec support and suspension are
  browser/OS concerns. SFX are transient; reconnect does not replay an old impact.
- No voice/video, spatial audio, dynamic lighting/LOS, rules engine or Story coupling.

## Capacity and support

- Desktop/laptop is the GM target. Player tablet/narrow layouts are supported with
  compact overlays; mobile GM authoring and complete screen-reader canvas editing
  are not promised. Keyboard controls, focus outlines and labelled controls cover
  the application chrome; the visual tabletop still needs pointer interaction.
- Fog uses two GPU masks capped at 2048 on the longest axis. A 4096-square scene
  therefore has two-world-pixel mask resolution. History is replayed on hydration;
  long histories increase payload/initial render time. No snapshot compaction yet.
- Texture count is not VRAM measurement: a decoded 4096-square RGBA map alone is
  roughly 64 MiB, plus masks, framebuffer, shared sprites and browser overhead.
- Local synthetic load results do not predict WAN latency, tablet GPU performance
  or a full evening. A real Safari/macOS/iPad check and multi-hour rehearsal remain
  release-environment checks. Windows Playwright WebKit is an engine smoke only.
  On that Windows harness, resizing the viewport sometimes left the composited
  canvas blank while a synchronous renderer readback was correct. Reload restored
  display. This remains an unresolved compatibility observation, not a Safari pass.
- Single application instance is the documented deployment. Queue jobs use the same
  database transaction as Cue execution; do not move the tabletop queue to Redis.

## Technical retention

Completed/cancelled Cue runs, their steps and associated trigger-fire details are
eligible after 90 days (minimum configurable 30). Any unfinished or failed run
protects its entire campaign from this pruning. Definitions, Session plans/notes,
combat records, trigger once counters and last-fire timestamps remain. Use
`tabletop:prune-executions --dry-run` before changing retention. This is technical
execution history, not a permanent session archive. Back up before maintenance.

Asset garbage collection, pagination of historical combat, immutable archives,
durable offline recovery and fog-history compaction are deferred.
