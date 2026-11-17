#!/usr/bin/env bash
#
# Warm the storefront's caches after a (re)start so the first visitors of a release - or of an
# Instagram peak that lands right after a deploy - hit prerendered HTML instead of a cold render.
#
# What gets warmed: the home, the shop and the other static listing pages, then every URL in the
# sitemaps (products, categories, brands, collections, posts, pages). Each request is made the way
# a phone makes it (a browser user agent, forwarded host/proto like Caddy), so it fills exactly the
# entries the public traffic reads: the ISR page entries and the `"use cache"` loader results.
#
# Usage:  warm.sh [port] [host]        defaults: 3000 and the SITE_ORIGIN host of /opt/namilux/.env
#         WARM_PARALLEL=4 WARM_MAX_URLS=2000 WARM_TIMEOUT=30 warm.sh
# Exit status is 0 even when some URLs fail: warming is best effort and never blocks a release.
set -uo pipefail

PORT=${1:-3000}
ENV_FILE=${ENV_FILE:-/opt/namilux/.env}
HOST=${2:-}
if [[ -z "$HOST" && -f "$ENV_FILE" ]]; then
  HOST=$(grep -E '^SITE_ORIGIN=' "$ENV_FILE" | sed -E 's#^SITE_ORIGIN=https?://##; s#/.*##; s#["'"'"']##g')
fi
HOST=${HOST:-namilux.ir}
PAR=${WARM_PARALLEL:-4}
MAX=${WARM_MAX_URLS:-2000}
TIMEOUT=${WARM_TIMEOUT:-30}
BASE="http://127.0.0.1:$PORT"
# A browser UA on purpose: a bot UA would take Next's blocking render path and warm nothing reusable.
UA="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 namilux-warm/1"

log() { printf '[%s] warm: %s\n' "$(date -u +%FT%TZ)" "$*"; }
get() { curl -s --max-time "$TIMEOUT" -A "$UA" -H "Host: $HOST" -H "X-Forwarded-Host: $HOST" -H "X-Forwarded-Proto: https" "$@"; }
locs() { grep -o '<loc>[^<]*</loc>' | sed -E 's#<loc>https?://[^/]+##; s#</loc>##'; }

if ! get -o /dev/null "$BASE/healthz/"; then
  log "storefront on :$PORT does not answer — nothing warmed"
  exit 0
fi

list=$(mktemp)
{
  printf '%s\n' / /shop/ /new/ /discount/ /gifts/ /blog/ /search/ /wishlist/
  for child in $(get "$BASE/sitemap_index.xml" | locs); do
    get "$BASE$child" | locs
  done
} | grep -E '^/' | awk '!seen[$0]++' | head -n "$MAX" > "$list"

total=$(wc -l < "$list")
start=$(date +%s)
log "$total URLs on :$PORT as $HOST (parallel $PAR)"
# One curl per URL; the status codes are counted at the end so a run is easy to judge from the log.
export UA HOST BASE TIMEOUT
xargs -a "$list" -P "$PAR" -I{} sh -c 'curl -s -o /dev/null --max-time "$TIMEOUT" -A "$UA" -H "Host: $HOST" -H "X-Forwarded-Host: $HOST" -H "X-Forwarded-Proto: https" -w "%{http_code}\n" "$BASE{}" || echo 000' \
  | sort | uniq -c | awk '{printf "  %s × %s\n", $2, $1}'
log "done in $(( $(date +%s) - start )) s"
rm -f "$list"
exit 0
