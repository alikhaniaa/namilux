#!/usr/bin/env bash
# No database/cloud calls: exercise backup.sh with fixture pg_dump and local rclone adapters.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d /tmp/nl-backup-test.XXXXXX)
trap '[[ "$temp" == /tmp/nl-backup-test.* ]] && rm -rf "$temp"' EXIT
mkdir -p "$temp/bin" "$temp/root/bin" "$temp/root/backups/media" "$temp/media" "$temp/offsite/media"
touch "$temp/root/backups/media/.first"
export NAMILUX_ROOT="$temp/root" MEDIA_DIR="$temp/media" TEST_REMOTE_ROOT="$temp/offsite" CALLS="$temp/calls"
export BACKUP_RCLONE_REMOTE=fixture:backup BACKUP_AGE_PUBLIC_KEY=
export PATH="$temp/bin:$PATH"
printf 'live image\n' > "$MEDIA_DIR/sha256-live.webp"
printf 'historical image\n' > "$TEST_REMOTE_ROOT/media/sha256-historical.webp"
cat > "$temp/bin/sudo" <<'SH'
#!/usr/bin/env bash
set -eu
[[ "$*" == '-u postgres pg_dump -Fc --no-owner namilux' ]] || exit 90
printf '%010001d' 0
SH
cat > "$temp/bin/rclone" <<'SH'
#!/usr/bin/env bash
set -eu
echo "$*" >> "$CALLS"
[[ ${FAIL_UPLOAD:-0} != 1 ]] || exit 91
[[ "$1" == copy && "$3" == fixture:backup/* ]] || exit 92
dest="$TEST_REMOTE_ROOT/${3#fixture:backup/}"
mkdir -p "$dest"
if [[ -d "$2" ]]; then cp -R "$2/." "$dest/"; else cp "$2" "$dest/"; fi
SH
cat > "$temp/bin/date" <<'SH'
#!/usr/bin/env bash
if [[ "$*" == '-u +%u' ]]; then printf '2\n'; else /usr/bin/date "$@"; fi
SH
printf '#!/usr/bin/env bash\nexit 0\n' > "$temp/bin/chown"
printf '#!/usr/bin/env bash\nexit 0\n' > "$temp/bin/logger"
printf '#!/usr/bin/env bash\necho notified >> "$CALLS"\n' > "$temp/root/bin/notify.sh"
chmod +x "$temp/bin/"* "$temp/root/bin/notify.sh"

bash "$here/backup.sh"
cmp "$MEDIA_DIR/sha256-live.webp" "$TEST_REMOTE_ROOT/media/sha256-live.webp"
[[ -f "$TEST_REMOTE_ROOT/media/sha256-historical.webp" ]]
grep -q '"ok":true' "$temp/root/backups/status.json"
grep -q '^copy .*fixture:backup/db/' "$CALLS"

# A subsequent local media deletion must not destroy the image required by an older dump.
rm "$MEDIA_DIR/sha256-live.webp"
bash "$here/backup.sh"
[[ -f "$TEST_REMOTE_ROOT/media/sha256-live.webp" ]]
[[ -f "$TEST_REMOTE_ROOT/media/sha256-historical.webp" ]]
! grep -q '^sync ' "$CALLS"

if FAIL_UPLOAD=1 bash "$here/backup.sh"; then exit 1; fi
grep -q '"ok":false' "$temp/root/backups/status.json"
grep -qx notified "$CALLS"
cp "$temp/root/backups/status.json" "$temp/full-status-before"
bash "$here/backup.sh" --db-only
cmp "$temp/full-status-before" "$temp/root/backups/status.json"
grep -q '"ok":true' "$temp/root/backups/db-status.json"
echo 'backup retention tests passed (3 scenarios; no database or cloud touched)'
