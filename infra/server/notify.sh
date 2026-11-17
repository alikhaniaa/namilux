#!/usr/bin/env bash
# One line to the owner's Telegram chat (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID from /opt/namilux/.env)
# and always to the journal. api.telegram.org is filtered on most Iranian networks: set TELEGRAM_PROXY
# (an https/socks5 proxy URL reachable from the server) or accept journal-only alerts (README §7).
#   notify.sh "⚠️ web unhealthy - restarted"
set -u
msg=${1:-}
[[ -n "$msg" ]] || exit 0
logger -t namilux "$msg"
[[ -f /opt/namilux/.env ]] && { set -a; source /opt/namilux/.env; set +a; }
[[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]] || exit 0
proxy=()
[[ -n "${TELEGRAM_PROXY:-}" ]] && proxy=(--proxy "$TELEGRAM_PROXY")
reply=$(mktemp)
trap 'rm -f "$reply"' EXIT
if ! curl --silent --fail --max-time 10 "${proxy[@]}" -o "$reply" \
  --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" \
  --data-urlencode "text=[$(hostname -s)] $msg" \
  "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage"; then
  logger -t namilux 'telegram delivery failed (transport/HTTP); response and token suppressed'
  exit 1
fi
if ! python3 - "$reply" <<'PY'
import json,sys
try:
    with open(sys.argv[1]) as f: response=json.load(f)
    valid=response.get('ok') is True
except (ValueError,OSError,AttributeError): valid=False
raise SystemExit(0 if valid else 1)
PY
then
  logger -t namilux 'telegram delivery failed (API response); response and token suppressed'
  exit 1
fi
exit 0
