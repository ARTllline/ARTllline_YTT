#!/usr/bin/env bash
set -euo pipefail
umask 077
# Run only after maintenance mode and stopping all writers; see BACKUP_RESTORE.md.
if [ "$#" -ne 4 ]; then
  echo 'Usage: backup.sh DATABASE MYSQL_DEFAULTS_FILE PRIVATE_STORAGE NEW_BACKUP_DIRECTORY' >&2
  exit 2
fi
database=$1
defaults=$2
assets=$3
destination=$4
[[ "$database" =~ ^[A-Za-z0-9_]+$ ]] || { echo 'Invalid database name' >&2; exit 2; }
[ -f "$defaults" ] && [ -d "$assets" ] || { echo 'Missing credentials file or private storage' >&2; exit 2; }
[ ! -e "$destination" ] || { echo 'Destination must be new' >&2; exit 2; }
mkdir -m 700 -- "$destination"
mysqldump --defaults-extra-file="$defaults" --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF --column-statistics=0 "$database" > "$destination/database.sql"
tar -C "$assets" -czf "$destination/private-assets.tar.gz" .
git rev-parse HEAD > "$destination/release.txt"
date -u +%FT%TZ > "$destination/created-at.txt"
(cd "$destination" && sha256sum database.sql private-assets.tar.gz release.txt created-at.txt > SHA256SUMS)
echo "Backup complete: $destination. Store APP_KEY/config separately in encrypted custody; test restore."
