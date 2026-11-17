#!/usr/bin/env bash
# Restores a dump made by backup.sh into the local Postgres and (optionally) the media directory,
# then re-applies the role grants and restarts the services. Run on a freshly provisioned box
# (provision.sh) after the first release is built, or on the live box in an incident.
#
#   restore.sh /opt/namilux/backups/db/db-20260902T000000Z.dump[.age] [/path/to/media-….tar.gz[.age]]
#   BACKUP_AGE_KEY_FILE=/root/backup-key.txt restore.sh …      (the OFFLINE private key, for .age files)
set -euo pipefail
ROOT=${NAMILUX_ROOT:-/opt/namilux}
dump=${1:?usage: restore.sh <db-dump[.age]> [media.tar.gz[.age]]}
media=${2:-}
start=$(date +%s)
umask 077
tmp=$(mktemp -d /tmp/nl-restore.XXXXXX); trap 'rm -rf "$tmp"' EXIT

decrypt() { # in → out path
  if [[ "$1" == *.age ]]; then
    [[ -n "${BACKUP_AGE_KEY_FILE:-}" ]] || { echo "set BACKUP_AGE_KEY_FILE to decrypt $1"; exit 2; }
    age -d -i "$BACKUP_AGE_KEY_FILE" -o "$2" "$1"
  else
    cp "$1" "$2"
  fi
}

echo "→ preparing and checking the backup before stopping the apps"
decrypt "$dump" "$tmp/db.dump"
# mktemp is root-owned mode 0700: postgres must own the directory as well as the dump
# to traverse it. Keep customer data private instead of granting world read/search access.
chown postgres:postgres "$tmp" "$tmp/db.dump"
chmod 700 "$tmp"
chmod 600 "$tmp/db.dump"
sudo -u postgres pg_restore --list "$tmp/db.dump" > /dev/null
if [[ -n "$media" ]]; then
  decrypt "$media" "$tmp/media.tar.gz"
  tar -tzf "$tmp/media.tar.gz" > /dev/null
fi

echo "→ stopping the apps (the worker must not write during the restore)"
systemctl stop namilux-worker namilux-web namilux-admin || true

echo "→ restoring database (pg_restore --clean --if-exists)"
sudo -u postgres pg_restore --clean --if-exists --no-owner --role=nl_migrate -d namilux "$tmp/db.dump"
sudo -u postgres psql -qc 'ALTER DATABASE namilux OWNER TO nl_migrate;'

if [[ -n "$media" ]]; then
  echo "→ restoring media into ${MEDIA_DIR:-$ROOT/media}"
  mkdir -p "${MEDIA_DIR:-$ROOT/media}"
  tar -xzf "$tmp/media.tar.gz" -C "${MEDIA_DIR:-$ROOT/media}"
  chown -R namilux:namilux "${MEDIA_DIR:-$ROOT/media}"
fi

if [[ -d $ROOT/current ]]; then
  echo "→ re-applying role grants (packages/db/roles.sql)"
  ( cd "$ROOT/current" && set -a && source "$ROOT/.env" && set +a && runuser -u namilux -- pnpm db:roles )
fi

echo "→ starting the apps"
systemctl start namilux-web namilux-admin namilux-worker
sleep 3
"$ROOT/bin/release.sh" status || true
echo "restore completed in $(( ($(date +%s) - start) / 60 )) min — record it in the operations log (drill monthly)"
