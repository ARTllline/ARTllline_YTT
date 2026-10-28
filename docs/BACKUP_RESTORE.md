# Consistent backup and restore

Back up **MySQL + all private originals/thumbnails + the matching APP_KEY and
environment configuration + release identity**. They form one recovery set.
Database transactions alone cannot snapshot file uploads/deletions atomically.
Back up outside a game, with all writers paused. Never test restoration over the
working database or private disk.

## Backup on Ubuntu

1. Enter maintenance: `sudo -u www-data php artisan down`.
2. Stop `ytt-scheduler.timer`, wait for any active `ytt-scheduler.service` tick,
   then stop `ytt-queue` and `ytt-reverb`. Allow HTTP requests/worker transactions
   to finish. Ensure no other CLI importer or operator is writing.
3. Prepare a root-readable MySQL client option file outside the web root, mode 600:

```ini
[client]
host=localhost
user=ytt
password=YOUR_EXISTING_DATABASE_PASSWORD
```

4. As the backup operator with access to files, from `/srv/ytt/current`:

```sh
bash scripts/backup.sh ytt /root/ytt-backup.cnf /srv/ytt/shared/storage/app/campaigns-private /srv/backups/ytt-2026-10-29
cd /srv/backups/ytt-2026-10-29
sha256sum -c SHA256SUMS
```

The destination must not already exist; the script never overwrites a backup.
Use a new timestamped name each time. Failure leaves an incomplete directory without
a complete checksum manifest; do not treat it as a successful backup.
The dump contains only the named DB, no CREATE DATABASE/USE targeting a live DB.
`--single-transaction` assumes InnoDB and no concurrent DDL. Credentials are read
from the protected file, never passed as command-line passwords.

5. Securely copy the existing `.env` (especially APP_KEY/Reverb credentials) into
   encrypted backup custody, along with a sanitized deployment configuration and
   release archive/commit. Do not put plaintext credentials into Git, the web root
   or a shared unencrypted archive. The script deliberately does not copy `.env`.
6. Restart Reverb/queue/scheduler timer, then `php artisan up`. Check doctor and a
   Player connection. Verify the backup exists in a second protected location.

Keep several dated recovery sets according to campaign needs. Never auto-delete
the sole verified recovery set. Cache/session/Redis data are not canonical scene
state; after restore users can sign in again. Uploaded originals are irreplaceable.

## Restore rehearsal — fresh database and storage only

Verify checksums first. Use a separate checkout/release and environment, loopback
HTTP port, private disk and database. Do not point the rehearsal at the production
queue/Reverb/cache: restored jobs must not execute against the live campaign.

```sql
CREATE DATABASE ytt_restore_check CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'ytt_restore'@'localhost' IDENTIFIED BY 'NEW_RANDOM_REHEARSAL_PASSWORD';
GRANT ALL PRIVILEGES ON ytt_restore_check.* TO 'ytt_restore'@'localhost';
```

With a separate protected client option file for that user:

```sh
mysql --defaults-extra-file=/root/ytt-restore.cnf ytt_restore_check < database.sql
mkdir -m 750 /srv/ytt-restore-private
tar -xzf private-assets.tar.gz -C /srv/ytt-restore-private
```

Use only your own trusted backup archives. Confirm the destination was empty and
all extracted paths stay under it. Configure the rehearsal disk root in its
`config/filesystems.php` (or an isolated storage-directory symlink), and use its
own `.env`: DB_DATABASE=ytt_restore_check, separate cache prefix/session store,
the preserved APP_KEY. Never run `key:generate` on restored data. Run config clear
in that isolated checkout, then doctor and migrate status; do not upgrade schema
until the restored release is verified.

Verify campaign/member/scene/token/prop/fog counts and representative values;
compare original asset hashes, open a map and handout, verify hidden/private media
denial in a Player context, run a Cue with an isolated worker if needed. A successful
SQL import without image verification is not a restore test.

For a destructive rehearsal: create a synthetic source DB/storage, back them up,
change/delete only those synthetic records/files, restore into a **second new**
DB/storage, and compare snapshots/hashes. Task 12 evidence is in VALIDATION.md.

## Actual recovery

Stop writers, preserve the damaged DB/storage for diagnosis, restore to new
locations and validate before repointing the application. Match code/schema/key.
Restart long-lived services with the restored configuration; clear transient cache
and require clients to reload. Interrupted Cue jobs are idempotent within the
restored snapshot; work performed after the backup is necessarily lost. Inspect
queued/failed runs before restarting the worker. Never advertise zero data loss.

Handout revoke/hide prevents future authorized downloads; backups and recipients'
previous downloads can still contain those bytes. This product does not provide DRM.
