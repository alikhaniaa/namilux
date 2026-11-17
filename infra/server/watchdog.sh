#!/usr/bin/env bash
# Runs every minute from namilux-watchdog.timer. Probes the loopback health endpoints; after
# three consecutive misses restarts the unit and alerts; alerts again every ten minutes while it stays
# down and once on recovery. Also watches disk and backup freshness. State lives in /run (cleared on boot).
set -u
ROOT=${NAMILUX_ROOT:-/opt/namilux}
STATE=${MAINTENANCE_STATE:-/run/namilux-watchdog}
source "$(dirname "${BASH_SOURCE[0]}")/maintenance.sh"
mkdir -p "$STATE"
host=$(grep -E '^SITE_ORIGIN=' "$ROOT/.env" 2>/dev/null | sed -E 's#^SITE_ORIGIN=https?://##; s#/.*##')
notify() { "$ROOT/bin/notify.sh" "$1"; }

check() { # unit url [host]
  local unit=$1 url=$2 h=${3:-$host} code f n=0
  if maintenance_active "namilux-$unit"; then echo 0 > "$STATE/$unit.misses"; return 0; fi
  code=$(curl -s -o /dev/null --max-time 8 -H "Host: ${h:-localhost}" -H "X-Forwarded-Proto: https" -w '%{http_code}' "$url") || code=000
  f=$STATE/$unit.misses
  [[ -f $f ]] && n=$(<"$f")
  if [[ "$code" == 200 ]]; then
    [[ $n -ge 3 ]] && notify "✅ $unit answers again"
    echo 0 > "$f"
    return 0
  fi
  n=$((n + 1)); echo "$n" > "$f"
  logger -t namilux-watchdog "$unit unhealthy ($code), miss $n"
  if [[ $n -eq 3 ]]; then
    # A build can begin while curl is waiting; recheck before undoing an intentional stop.
    if maintenance_active "namilux-$unit"; then echo 0 > "$f"; return 0; fi
    systemctl restart "namilux-$unit"
    notify "⚠️ $unit unhealthy (HTTP $code) three times — restarted"
  elif [[ $n -gt 3 && $((n % 10)) -eq 0 ]]; then
    notify "🚨 $unit still unhealthy after $n minutes (HTTP $code)"
  fi
}

check web    http://127.0.0.1:3000/healthz/
check admin  http://127.0.0.1:3100/healthz
check worker http://127.0.0.1:3200/healthz


# disk: alert at 85 %, at most every six hours
use=$(df --output=pcent /opt | tail -1 | tr -dc '0-9')
if [[ ${use:-0} -ge 85 ]]; then
  flag=$STATE/disk
  if [[ ! -f $flag || $(( $(date +%s) - $(stat -c %Y "$flag") )) -gt 21600 ]]; then
    notify "💾 disk ${use}% used on /opt — prune releases/backups (release.sh status)"; touch "$flag"
  fi
fi

# backup freshness: status.json must be younger than 26 h and ok - checked once an hour
if (( 10#$(date +%M) == 7 )); then
  st=$ROOT/backups/status.json
  if [[ ! -f $st ]] || [[ $(( $(date +%s) - $(stat -c %Y "$st") )) -gt 93600 ]] || ! grep -q '"ok":true' "$st"; then
    notify "🗄️ backup stale or failed — check namilux-backup.service (journalctl -u namilux-backup)"
  fi
  # Weekly media archives have their own deadline; a recent database dump cannot mask stale images.
  if [[ -z $(find "$ROOT/backups/media" -maxdepth 1 -type f -name 'media-*.tar.gz*' -size +0c -mmin -12960 -print -quit 2>/dev/null) ]]; then
    notify "🗄️ media backup missing or older than 9 days — check namilux-backup.service"
  fi
fi
exit 0
