# Task 01 validation

Validated on Windows with PHP 8.3.32, Node 20.20.2 and the installed lockfiles.

## Automated checks

- `composer test`: 2 feature tests / 6 assertions. Workspace boots without a
  database connection or authentication; `/up` responds successfully.
- `npm run test`: 15 meaningful tests. Fractional and negative world-coordinate
  round trips; cursor-anchored zoom at each interpolation step; zoom bounds;
  cell-center snap, offsets and disabled snap; immutable scene updates;
  preview/commit separation; selection; invalid values; HP and grid validation.
- `npm run typecheck`: strict TypeScript.
- `npm run lint`: ESLint, TypeScript and React Hooks rules.
- `npm run build`: production Vite build, with renderer loaded separately.
- `npm audit`: 0 known vulnerabilities after upgrading Vitest to its fixed branch.

The agent sandbox initially denied Vite's native `realpath` and loopback socket
access on drive B:. Tests/build and the Laravel dev server succeeded with the
appropriate execution permission. There is no workaround embedded in source.

## Browser checks

Playwright controlled a real Chromium browser against Laravel serving the
**production bundle** at `http://127.0.0.1:8000/`.

- Shell, original vector map, four tokens and canvas render; one canvas only.
- Canvas click selects Kern; background click/Escape clear selection.
- Drag preview updates while held and receives the final trailing sample.
- Drag from `(630, 750)` toward `(708, 655)` lands at `(690, 630)` with 60 px snap.
- Escape during drag restores the previous committed position.
- Middle mouse and Space + drag pan over a token without changing its coordinates.
- Wheel zoom increases 60% → 82% while the same token remains under the cursor.
- Rotation 90°, scale 1.3 and HP 12 edits round-trip through Inspector.
- Escape in a numeric draft discards it instead of accidentally committing on blur.
- With snap off, a drag to `(707, 653)` keeps those exact coordinates.
- Grid visibility, 80 px cell size and X offset 10 do not move existing tokens.
- Hiding/showing library resizes the canvas and preserves world coordinates.
- Shortcut dialog opens, traps focus via native dialog and closes with Escape.
- Long names wrap in panels; canvas names abbreviate for readability.
- Widths 1920, 1440, 1366, 1180, 1179, 900, 899, 768 and 390 were checked;
  no document horizontal overflow, no duplicate canvas, no lost token position.
- Narrow panel open/close paths were tested after fixing overlay collisions.
- Vite development mode also boots with one canvas under React StrictMode;
  toolbar Pan, background deselection and window-blur drag rollback were exercised.
- A simulated `webglcontextlost` event displays the renderer recovery overlay;
  its reload button restores the scene. This is an event-path check, not a physical GPU failure test.
- Desktop and 390 px screenshots were visually inspected; native browser console
  reported no warnings/errors during normal interaction.

Local QA screenshots are in ignored `artifacts/` (not required to run the app).

## Repeatable manual acceptance

1. Run the production build and `php artisan serve`; open `/`.
2. Select a token directly, drag from its edge, inspect the preview and drop.
3. Toggle snap and grid independently; change size/offset; repeat the drag.
4. Hold Space and drag over a token; middle-drag; zoom around a token under cursor.
5. Edit position, rotation, scale and HP; try blank/invalid values and Escape.
6. Cancel a drag with Escape, browser blur and pointer cancellation.
7. Toggle both panels; resize across the documented breakpoints; inspect long names.
8. Verify Assets/Cues/Present and future tools clearly indicate deferred behavior.
9. Reload and confirm the demo intentionally resets, matching its status message.

No multiplayer, real persistence or production deployment was tested or claimed.
