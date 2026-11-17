#!/usr/bin/env bash
# Never wipes rules on a failed/empty fetch.
set -euo pipefail
SRC="${ARVAN_RANGES_URL:-https://www.arvancloud.ir/fa/ips.txt}"
tmp="$(mktemp)"
curl -sf "$SRC" -o "$tmp" || { echo "fetch failed; keeping existing rules"; exit 1; }
grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?' "$tmp" | sort -u > "$tmp.clean"
[ -s "$tmp.clean" ] || { echo "empty range list; keeping existing rules"; exit 1; }
# Remove old CDN-tagged rules, add the fresh set (comment tag 'cdn-origin').
ufw status numbered | awk '/cdn-origin/{print $1}' | tr -d '[]' | sort -rn | while read -r n; do ufw --force delete "$n" || true; done
while read -r cidr; do ufw allow from "$cidr" to any port 443 proto tcp comment 'cdn-origin'; done < "$tmp.clean"
echo "applied $(wc -l < "$tmp.clean") CDN ranges"
rm -f "$tmp" "$tmp.clean"
