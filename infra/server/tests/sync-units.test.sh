#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
export UNIT_ROOT="$temp/units" CONTROL_ROOT="$temp/control"
mkdir -p "$UNIT_ROOT" "$CONTROL_ROOT/namilux-web.service.d" "$temp/bin"
printf '[Service]\nMemoryHigh=1200M\nMemoryMax=1500M\n' > "$UNIT_ROOT/namilux-web.service"
cp "$UNIT_ROOT/namilux-web.service" "$temp/original"
printf '[Service]\nMemoryHigh=1572864000\n' > "$CONTROL_ROOT/namilux-web.service.d/50-MemoryHigh.conf"
printf '[Service]\nMemoryMax=1887436800\n' > "$CONTROL_ROOT/namilux-web.service.d/50-MemoryMax.conf"
printf '[Service]\nNice=1\n' > "$CONTROL_ROOT/namilux-web.service.d/60-unrelated.conf"
cat > "$temp/bin/systemctl" <<'SH'
#!/usr/bin/env bash
set -eu
if [[ $1 == daemon-reload ]]; then exit 0; fi
if [[ ${FAIL_VERIFY:-0} == 1 ]]; then echo 1; exit 0; fi
file="$UNIT_ROOT/$2.service"
sed -n "s/^$4=//p" "$file" | numfmt --from=iec
SH
chmod +x "$temp/bin/systemctl"
export PATH="$temp/bin:$PATH"
bash "$here/sync-units.sh" install "$here/systemd" "$temp/backup"
cmp "$UNIT_ROOT/namilux-web.service" "$here/systemd/namilux-web.service"
[[ ! -e "$CONTROL_ROOT/namilux-web.service.d/50-MemoryHigh.conf" ]]
[[ -e "$CONTROL_ROOT/namilux-web.service.d/60-unrelated.conf" ]]
bash "$here/sync-units.sh" restore "$temp/backup"
cmp "$UNIT_ROOT/namilux-web.service" "$temp/original"
[[ -e "$CONTROL_ROOT/namilux-web.service.d/50-MemoryHigh.conf" ]]
[[ ! -e "$UNIT_ROOT/namilux-admin.service" ]]
if FAIL_VERIFY=1 bash "$here/sync-units.sh" install "$here/systemd" "$temp/failure-backup"; then
  echo 'verification failure did not fail install'; exit 1
fi
cmp "$UNIT_ROOT/namilux-web.service" "$temp/original"
[[ -e "$CONTROL_ROOT/namilux-web.service.d/50-MemoryMax.conf" ]]
echo 'unit reconciliation/rollback tests passed'
