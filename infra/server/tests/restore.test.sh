#!/usr/bin/env bash
# Execute restore.sh against private fixtures with every privileged action stubbed.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d /tmp/nl-restore-test.XXXXXX)
trap '[[ "$temp" == /tmp/nl-restore-test.* ]] && rm -rf "$temp"' EXIT
mkdir -p "$temp/bin" "$temp/root/bin" "$temp/media"
export NAMILUX_ROOT="$temp/root" MEDIA_DIR="$temp/media" CALLS="$temp/calls"
export PATH="$temp/bin:$PATH"
printf 'fixture archive\n' > "$temp/db.dump"
cp "$temp/db.dump" "$temp/db.dump.age"
printf 'fixture media\n' > "$temp/media.tar.gz"
cat > "$temp/bin/sudo" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == -u && "$2" == postgres ]] || exit 90
shift 2
if [[ "$1" == pg_restore ]]; then
  file=${!#}
  parent=${file%/*}
  grep -Fxq "chown postgres:postgres $parent $file" "$CALLS" || exit 91
  grep -Fxq "chmod 700 $parent" "$CALLS" || exit 92
  grep -Fxq "chmod 600 $file" "$CALLS" || exit 93
  if [[ "$2" == --list ]]; then
    echo check-db >> "$CALLS"
    [[ ${CORRUPT_DB:-0} != 1 ]] || exit 94
  else
    grep -q '^systemctl stop ' "$CALLS" || exit 95
    echo restore-db >> "$CALLS"
  fi
elif [[ "$1" == psql ]]; then
  echo alter-owner >> "$CALLS"
else
  exit 96
fi
SH
cat > "$temp/bin/systemctl" <<'SH'
#!/usr/bin/env bash
set -eu
echo "systemctl $*" >> "$CALLS"
if [[ "$1" == stop ]]; then
  grep -qx check-db "$CALLS"
  [[ ${EXPECT_MEDIA:-0} != 1 ]] || grep -qx check-media "$CALLS"
fi
SH
cat > "$temp/bin/tar" <<'SH'
#!/usr/bin/env bash
set -eu
case "$1" in
  -tzf) echo check-media >> "$CALLS"; [[ ${CORRUPT_MEDIA:-0} != 1 ]] ;;
  -xzf) grep -qx restore-db "$CALLS"; echo restore-media >> "$CALLS" ;;
  *) exit 97 ;;
esac
SH
cat > "$temp/bin/age" <<'SH'
#!/usr/bin/env bash
set -eu
echo decrypt >> "$CALLS"
[[ ${FAIL_DECRYPT:-0} != 1 ]] || exit 98
[[ "$1" == -d && "$2" == -i && "$4" == -o ]] || exit 99
cp "$6" "$5"
SH
for cmd in chown chmod; do
  printf '#!/usr/bin/env bash\necho "%s $*" >> "$CALLS"\n' "$cmd" > "$temp/bin/$cmd"
done
printf '#!/usr/bin/env bash\nexit 0\n' > "$temp/bin/sleep"
printf '#!/usr/bin/env bash\necho release-status >> "$CALLS"\n' > "$temp/root/bin/release.sh"
# Explicit executable path: PATH's chmod is a stub for the script under test.
/usr/bin/chmod +x "$temp/bin/"* "$temp/root/bin/release.sh"

reset_calls() { : > "$CALLS"; }
assert_not_stopped() { ! grep -q '^systemctl ' "$CALLS"; }
reset_calls
bash "$here/restore.sh" "$temp/db.dump"
grep -qx restore-db "$CALLS"
grep -qx 'systemctl start namilux-web namilux-admin namilux-worker' "$CALLS"

reset_calls
EXPECT_MEDIA=1 bash "$here/restore.sh" "$temp/db.dump" "$temp/media.tar.gz"
grep -qx restore-media "$CALLS"

reset_calls
if CORRUPT_DB=1 bash "$here/restore.sh" "$temp/db.dump"; then exit 1; fi
assert_not_stopped

reset_calls
if CORRUPT_MEDIA=1 bash "$here/restore.sh" "$temp/db.dump" "$temp/media.tar.gz"; then exit 1; fi
assert_not_stopped

reset_calls
if BACKUP_AGE_KEY_FILE= bash "$here/restore.sh" "$temp/db.dump.age"; then exit 1; fi
assert_not_stopped

reset_calls
if BACKUP_AGE_KEY_FILE=fixture-key FAIL_DECRYPT=1 bash "$here/restore.sh" "$temp/db.dump.age"; then exit 1; fi
assert_not_stopped

reset_calls
BACKUP_AGE_KEY_FILE=fixture-key bash "$here/restore.sh" "$temp/db.dump.age"
grep -qx decrypt "$CALLS"
grep -qx restore-db "$CALLS"
echo 'restore preflight/permissions tests passed (7 scenarios; no services or database touched)'
