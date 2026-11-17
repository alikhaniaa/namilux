#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
export MAINTENANCE_STATE="$temp/state"
source "$here/maintenance.sh"
maintenance_begin
maintenance_mark namilux-admin
maintenance_active namilux-admin || { echo 'live build was not protected'; exit 1; }
if maintenance_active namilux-web; then echo 'unpaused web was suppressed'; exit 1; fi
flock -u 8
if maintenance_active namilux-admin; then echo 'orphan marker suppressed recovery'; exit 1; fi
[[ ! -e "$MAINTENANCE_STATE/namilux-admin.paused" ]]

# Exercise the actual watchdog with mocked services/curl, never the machine's systemd.
mkdir -p "$temp/bin" "$temp/root/bin"
printf 'SITE_ORIGIN=https://example.test\n' > "$temp/root/.env"
printf '#!/usr/bin/env bash\nexit 0\n' > "$temp/root/bin/notify.sh"
cat > "$temp/bin/systemctl" <<'SH'
#!/usr/bin/env bash
if [[ $1 == restart ]]; then echo "$2" >> "$CALLS"; fi
if [[ $1 == is-enabled ]]; then exit 1; fi
SH
printf '#!/usr/bin/env bash\nprintf 000\n' > "$temp/bin/curl"
printf '#!/usr/bin/env bash\nexit 0\n' > "$temp/bin/logger"
chmod +x "$temp/bin/"* "$temp/root/bin/notify.sh"
export CALLS="$temp/restarts" NAMILUX_ROOT="$temp/root"
export PATH="$temp/bin:$PATH"
maintenance_begin
maintenance_mark namilux-admin
maintenance_mark namilux-worker
for i in 1 2 3; do bash "$here/watchdog.sh"; done
[[ $(cat "$CALLS") == namilux-web ]]
flock -u 8
for i in 1 2 3; do bash "$here/watchdog.sh"; done
grep -qx namilux-admin "$CALLS"
grep -qx namilux-worker "$CALLS"
echo 'maintenance/watchdog tests passed'
