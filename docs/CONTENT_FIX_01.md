# CONTENT-FIX-01 — schema prerequisite for system item copies

## Exact cause and required migration

`ItemLibrary::copyCompendium()` creates a private LibraryItem and then calls
`CompendiumContent::receipt()` with `campaignId=null`. On the original schema,
`compendium_copies.campaign_id` is NOT NULL and `owner_user_id` is absent.
`receipt()` deliberately returns HTTP 503 instead of losing ownership/provenance.
The transaction rolls back both LibraryItem and command receipt.

The one required migration is:

`database/migrations/2026_11_12_170000_add_compendium_copy_contracts.php`

| Change | Existing rows |
| --- | --- |
| Make `compendium_copies.campaign_id` nullable | Existing campaign IDs and foreign keys are preserved |
| Add nullable `owner_user_id`, FK users, RESTRICT delete | Old receipts receive NULL; no ownership is invented |
| Add nullable JSON `item_definitions.content` | Existing item definitions receive NULL; their gameplay stays unchanged |

The Compendium, item gameplay and global Item Library migrations from October
are prerequisites already present in the local DB. They must not be rerun.
Initial live status: 53 applied migrations; only this consumer migration pending.

## Backup and compatibility rehearsal

The protected, Git-ignored recovery set is under
`artifacts/content-fix-01/backup/`: database.sql, private-assets.tar.gz,
the asset hash manifest, Windows-DPAPI encrypted environment.dpapi and SHA256SUMS.
The configuration ciphertext can be decrypted only in the original Windows user
context; keep the original APP_KEY/configuration. Do not publish the SQL or config.

The DB backup uses MySQL 8 mysqldump, `--single-transaction --quick
--skip-lock-tables --no-tablespaces --set-gtid-purged=OFF --column-statistics=0
--hex-blob`, without CREATE DATABASE/USE. All source tables are InnoDB; there are
no stored routines, triggers or events. This is an online consistent DB snapshot;
no schema changes or application writes were performed on live by this task.
For a future deployment recovery set, pause writers as BACKUP_RESTORE.md requires
and take a fresh backup immediately before the approved schema change.

The rehearsal uses a separate Open Server MySQL 8 process, loopback port 3312,
fresh datadir, schema and DB user limited to that schema. It does not use or
extend the live application's database privileges. HTTP is isolated on port 8092,
with separate storage, sessions, bootstrap cache and logs. No rehearsal workers
or scheduler run; broadcasting is null; its database queue points to its own DB.
The existing QA accounts/campaign/Scene 7 come from the backup, without reseeding.

## Future local-live application plan — not executed

1. Confirm maintenance outside play and explicit authorization for live schema
   activation. This task does not provide that authorization.
2. Stop writers and wait for active requests/jobs. Take a new protected consistent
   DB/private-storage backup; preserve configuration and the matching code.
3. Verify the backup SHA-256, restore it to a fresh isolated location, check row
   fingerprints/assets and ensure the expected migration is the only pending one.
4. Check no orphan campaign/entry/character references, original column shapes,
   table engines and migration checksum. Check DDL lock availability.
5. Review only this migration's SQL:

   ```powershell
   php artisan migrate --path=database/migrations/2026_11_12_170000_add_compendium_copy_contracts.php --pretend --no-interaction
   ```

6. After the separate approval, apply only that file, without seed/import:

   ```powershell
   php artisan migrate --path=database/migrations/2026_11_12_170000_add_compendium_copy_contracts.php --force --no-interaction
   ```

7. Check all three schema postconditions, preserved old rows/FKs, migration record,
   copy/edit/reload, owner-only access, retry, equipment and player projection.
   Restart the application's long-lived services with matching code; monitor logs.

MySQL DDL is not a multi-table transaction. If interrupted, stop and inspect the
actual schema; do not blindly rerun a partially completed migration. Restore the
verified backup to a new database or prepare a narrowly reviewed forward repair.
Do not reset/truncate tables to make the migration pass.

Rollback is safe only before new versioned/library receipts or content exist.
The migration's `down()` refuses to discard owner-scoped receipts or provenance.
After users create copies, prefer an application rollback compatible with the
additive schema. A DB restore loses post-backup writes and needs its own approval;
never bypass the down guard or delete user copies to enable rollback.

## Regression test

`CompendiumCopySchemaTest` reproduces old-schema 503 and transactional rollback,
applies the additive migration over a historical campaign receipt, retries the
same failed command successfully, checks replay, private edit/reload, unchanged
source and receipt snapshot, cross-owner denial, separate per-owner mutation IDs,
grant/unequip AC and runtime independence from later template edits.

```powershell
php vendor/phpunit/phpunit/phpunit --filter CompendiumCopySchemaTest
```

All migration-based PHPUnit checks use the existing SQLite `:memory:` configuration;
they must never be pointed at the persistent live or rehearsal MySQL database.

## Verified outcome — 12 November 2026

The 503 is resolved on the isolated native application:
`http://localhost:8092/control/items`, MySQL 8.0.30 on port 3312,
schema `ytt_content_fix_20261112_160724_01ee`.
Live `localhost:8090` / `ytt_local` remains on its original schema.

| Check | Result |
| --- | --- |
| Backup restore before any migration | All 73 table row fingerprints identical; all 1,268 private file hashes verified |
| Compatibility | Zero orphan receipt references; existing 686 receipts and 14 item definitions preserved |
| MySQL migration rehearsal | `pretend → up → down → up → migrate` passed; final repeat: Nothing to migrate |
| Schema verification | Correct nullability/JSON column and owner FK RESTRICT; old three FKs preserved; old added fields NULL |
| SQLite regression suite | 87 tests, 981 assertions passed, including the new 40-assertion schema regression |
| Real browser | 7 composite scenarios passed in GM/Player contexts; no API mocks and no React runtime errors |
| Copy and provenance | HTTP 200; same-command replay returns the same UUID; three owner-scoped receipts/snapshots checked |
| Edit/reload and independence | Edited private Longsword survives reload; full system catalogue fingerprint unchanged |
| Permissions | Player cannot list/edit/grant GM templates; Player can create a distinct own template |
| Equipment | Existing QA hero in campaign 5 / Scene 7: Shield adds 2 AC, grant replay adds no second item, Player sees runtime item; template edit leaves runtime unchanged; equipment restored |
| Rollback after copying | `down()` refuses before DDL, preserves receipts and both added columns |
| Frontend fixture regression | 4 browser scenarios passed; Save now waits for HTTP 200 and editor closure before reload |
| Final live audit | All 73 live table fingerprints still identical; live migrations remain 53, isolated migrations 54 |

Migration SHA-256:
`bad9678e9795aadd6dcef808abc34f1205906806df6937366e5bd2280cc5b77c`.

Evidence under `artifacts/content-fix-01/`: preflight-report.json,
verification-original.json, verification-up.json, verification-rollback.json,
browser-report.json, post-browser-report.json, live-final-comparison.json and
live-full-final-report.json.
Screenshots: gm-copy-edit-reload.png, player-own-copy.png,
gm-character-equipment.png and gm-mobile.png.

The test application/database remain available for inspection; their connection
file and datadir are protected under runtime/. Rehearsal SQL, config and backup
contents must remain private. The ordinary YTT launcher includes migrate/seed;
it was not used to activate the live consumer schema.

No CONTENT-05 import, seed, B/C approval or live migration was performed.
The functional fix requires the existing migration, without a parallel library
or gameplay rewrite. Changes to tracked code are regression coverage and the
frontend smoke's Save/reload synchronization.

Existing presentation limitation: legacy private item cards display “Версия правил
не указана”; their immutable receipt retains source version/checksum/snapshot.
Receipt-to-card presentation is outside this schema fix.
