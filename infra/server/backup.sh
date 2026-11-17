#!/usr/bin/env bash
#
#   backup.sh            database + media (the timer)      backup.sh --db-only   (release.sh migrate: BACKUP_PREFIX=pre)
# Env (from /opt/namilux/.env): BACKUP_AGE_PUBLIC_KEY (age1…, optional but strongly recommended - the
# private key lives OFFLINE), BACKUP_RCLONE_REMOTE (e.g. arvan:namilux-backups; empty = local only),
# BACKUP_KEEP_DAILY (30), BACKUP_KEEP_MONTHLY (12), MEDIA_DIR (/opt/namilux/media).
# Local copies live in /opt/namilux/backups/{db,media} (root only: the dumps hold customer data).
# The outcome is written twice: backups/status.json for the watchdog (root), and a world-readable
# copy at $ROOT/backup-status.json (the worker's BACKUP_STATUS_PATH) for the worker's daily report, which
# runs as `namilux` and cannot enter the 700 backups directory - it used to alert «status file
# missing or unreadable» every day while every backup was fine (found 23 Sep 2026).
set -euo pipefail
ROOT=${NAMILUX_ROOT:-/opt/namilux}
DIR=$ROOT/backups
STATUS=$DIR/status.json
PUBLIC_STATUS=$ROOT/backup-status.json
# A deployment dump must not overwrite the nightly database+media success marker.
if [[ "${1:-}" == --db-only ]]; then STATUS=$DIR/db-status.json; PUBLIC_STATUS=$STATUS; fi
TS=$(date -u +%Y%m%dT%H%M%SZ)
PREFIX=${BACKUP_PREFIX:-db}
KEEP_DAILY=${BACKUP_KEEP_DAILY:-30}
KEEP_MONTHLY=${BACKUP_KEEP_MONTHLY:-12}
MEDIA=${MEDIA_DIR:-$ROOT/media}
REMOTE=${BACKUP_RCLONE_REMOTE:-}
mkdir -p "$DIR/db" "$DIR/media"
chmod 700 "$DIR"
exec 9>"$DIR/.backup.lock"
flock -n 9 || { echo 'another backup is running' >&2; exit 1; }

write_status() {
  printf '{"at":"%s","ok":%s,"bytes":%s,"file":"%s","error":"%s"}\n' "$(date -u +%FT%TZ)" "$1" "${2:-0}" "${3:-}" "${4:-}" > "$STATUS"
  chmod 600 "$STATUS"
  # The worker's copy: outside the private directory, readable by the app user, nothing secret in it.
  if [[ "$PUBLIC_STATUS" != "$STATUS" ]]; then
    install -m 644 "$STATUS" "$PUBLIC_STATUS" 2>/dev/null || true
  fi
}
fail() { write_status false 0 "" "$1"; "$ROOT/bin/notify.sh" "🗄️ backup FAILED: $1"; exit 1; }
trap 'fail "unexpected failure at line $LINENO"' ERR

# 1. database - peer auth over the local socket, no password on the command line
dump="$DIR/db/${PREFIX}-${TS}.dump"
sudo -u postgres pg_dump -Fc --no-owner namilux > "$dump"
if [[ -n "${BACKUP_AGE_PUBLIC_KEY:-}" ]]; then
  age -r "$BACKUP_AGE_PUBLIC_KEY" -o "$dump.age" "$dump" && rm -f "$dump"
  dump="$dump.age"
fi
chmod 600 "$dump"
bytes=$(stat -c %s "$dump")
[[ $bytes -gt 10000 ]] || fail "dump is suspiciously small ($bytes bytes)"

# 2. media - content-hashed files are copied incrementally; retain deleted objects offsite so
# older database dumps keep their images. Remote retention is explicit, like the database copies.
# A local full tar is also kept weekly.
if [[ "${1:-}" != "--db-only" && -d "$MEDIA" ]]; then
  if [[ -n "$REMOTE" ]]; then
    rclone copy "$MEDIA" "$REMOTE/media" --transfers 4 --checkers 8 --quiet || fail "media copy to $REMOTE failed"
  fi
  if [[ "$(date -u +%u)" == 7 || ! -f $DIR/media/.first ]]; then
    tar --create --gzip --file "$DIR/media/media-$TS.tar.gz" -C "$MEDIA" . && touch "$DIR/media/.first"
    if [[ -n "${BACKUP_AGE_PUBLIC_KEY:-}" ]]; then
      age -r "$BACKUP_AGE_PUBLIC_KEY" -o "$DIR/media/media-$TS.tar.gz.age" "$DIR/media/media-$TS.tar.gz" && rm -f "$DIR/media/media-$TS.tar.gz"
    fi
  fi
fi

# 3. offsite copy of the dump
if [[ -n "$REMOTE" ]]; then
  rclone copy "$dump" "$REMOTE/db/" --quiet || fail "dump upload to $REMOTE failed"
fi

# 4. retention (local; the remote keeps everything until pruned by hand - cheaper than losing a month)
find "$DIR/db" -name 'db-*' -type f -mtime +"$KEEP_DAILY" ! -name 'db-*01T*' -delete
find "$DIR/db" -name 'db-*01T*' -type f -mtime +$((KEEP_MONTHLY * 31)) -delete
find "$DIR/db" -name 'pre-*' -type f -mtime +7 -delete
find "$DIR/media" -name 'media-*' -type f -mtime +60 -delete

write_status true "$bytes" "$(basename "$dump")" ""
logger -t namilux-backup "ok $(basename "$dump") ${bytes} bytes${REMOTE:+ → $REMOTE}"
