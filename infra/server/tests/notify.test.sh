#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d /tmp/namilux-notify-fixture.XXXXXX)
trap '[[ "$temp" == /tmp/namilux-notify-fixture.* ]] && rm -rf "$temp"' EXIT
mkdir "$temp/bin"
sed "s#/opt/namilux/.env#$temp/settings#g" "$here/notify.sh" > "$temp/notify.sh"
printf 'TELEGRAM_BOT_TOKEN=fixture\nTELEGRAM_CHAT_ID=fixture\n' > "$temp/settings"
cat > "$temp/bin/curl" <<'SH'
#!/usr/bin/env bash
set -eu
[[ ${HTTP_FAIL:-0} == 0 ]] || exit 22
while [[ $# -gt 0 ]]; do
  if [[ $1 == -o ]]; then printf '%s' "${RESPONSE:-}" > "$2"; break; fi
  shift
done
SH
printf '#!/usr/bin/env bash\nexit 0\n' > "$temp/bin/logger"
chmod +x "$temp/bin/"*
export PATH="$temp/bin:$PATH"
RESPONSE='{"ok":true}' bash "$temp/notify.sh" fixture
if RESPONSE='{"ok":false}' bash "$temp/notify.sh" fixture; then exit 1; fi
if RESPONSE='not json' bash "$temp/notify.sh" fixture; then exit 1; fi
if HTTP_FAIL=1 bash "$temp/notify.sh" fixture; then exit 1; fi
echo 'PASS: Telegram success, API failure, malformed response and HTTP failure (no messages sent)'
