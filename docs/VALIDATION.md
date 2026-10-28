# Task 02 validation

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
