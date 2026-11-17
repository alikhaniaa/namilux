#!/usr/bin/env bash
#
# Layout (provision.sh):  /opt/namilux/releases/<name>   a full checkout with node_modules and builds
#                         /opt/namilux/current  → symlink to the live release (the systemd units start from it)
#                         /opt/namilux/.env     secrets (root:namilux 600) · /opt/namilux/media · /opt/namilux/backups
#
# Usage (on the server, as root - the deploy user has sudo for exactly this script):
#   release.sh <name> fetch - read a `git archive` tarball (gzip) from STDIN into releases/<name>,
#                                  seeded with node_modules from the live release (no registry needed)
#   release.sh <name> install - pnpm install --frozen-lockfile (only when the lockfile changed)
#   release.sh <name> build - production build of web + admin (NEXT_PUBLIC_BUILD_ID=<name>), and of
#   release.sh <name> migrate - pre-migrate backup, then drizzle migrations + role grants
#   release.sh <name> rollback - current → the release that was live before <name>; restart; probe
#   release.sh <name> all - fetch → install → migrate → build → stage → activate  (deploy-from-local.sh)
#   release.sh <name> rebuild - clone → migrate → build → activate: the live source with the environment
#   release.sh check-env - validate /opt/namilux/.env with the app's own schema (nothing starts on a bad env)
#   release.sh set-env KEY=VALUE … - edit /opt/namilux/.env in place: back it up, replace (or uncomment, or
#                                  append) each key, then check-env - a failed validation puts the backup
#                                  back. Values are never printed. Use it for a change that needs no
#                                  rebuild (drivers, credentials, APP_ENV); an ORIGIN needs `rebuild`.
#   release.sh status | logs [web|admin|worker] | restart [web|admin|worker|all]
set -euo pipefail

ROOT=/opt/namilux
RELEASES=$ROOT/releases
CURRENT=$ROOT/current
ENV_FILE=$ROOT/.env
KEEP_RELEASES=${KEEP_RELEASES:-3}
source "$(dirname "${BASH_SOURCE[0]}")/maintenance.sh"
# exported so the sub-invocations of `all` and `rebuild` below see it (PROBE_HOST=x release.sh … all)
export PROBE_HOST=${PROBE_HOST:-}


name=${1:-}
action=${2:-}
arg=${3:-}
if [[ "$name" == "status" || "$name" == "logs" || "$name" == "check-env" || "$name" == "warm" || "$name" == "restart" || "$name" == "set-env" ]]; then action=$name; arg=${2:-}; name=""; fi
[[ -n "$action" ]] || { sed -n '8,25p' "$0"; exit 2; }
release=$RELEASES/$name
[[ -z "$name" || "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || { echo 'Invalid release name' >&2; exit 2; }
[[ ! -L "$release" ]] || { echo 'Release directory must not be a symlink' >&2; exit 2; }

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }
site_host() { [[ -n "$PROBE_HOST" ]] && { echo "$PROBE_HOST"; return; }; grep -E '^SITE_ORIGIN=' "$ENV_FILE" | sed -E 's#^SITE_ORIGIN=https?://##; s#/.*##'; }

probe() { # port path [attempts] [host]
  local port=$1 path=$2 tries=${3:-30} host=${4:-} status
  [[ -n "$host" ]] || host=$(site_host)
  for ((i = 1; i <= tries; i++)); do
    status=$(curl --silent --max-time 10 -H "Host: $host" -H "X-Forwarded-Host: $host" -H "X-Forwarded-Proto: https" \
      "http://127.0.0.1:$port$path" -o /dev/null -w '%{http_code}') || status=000
    [[ "$status" == 200 ]] && { log "ok  :$port$path"; return 0; }
    sleep 1
  done
  log "probe failed: :$port$path → $status"; return 1
}

standalone() { echo "$release/apps/$1/.next/standalone/apps/$1"; }

# The apps validate NEXT_PUBLIC_BUILD_ID at start-up (a public build must not run as "dev"), and the
# systemd units read it from the env file - so the live release's name is written there on every switch.
set_build_id() {
  if grep -q '^NEXT_PUBLIC_BUILD_ID=' "$ENV_FILE"; then sed -i "s/^NEXT_PUBLIC_BUILD_ID=.*/NEXT_PUBLIC_BUILD_ID=$1/" "$ENV_FILE"
  else printf 'NEXT_PUBLIC_BUILD_ID=%s\n' "$1" >> "$ENV_FILE"; fi
}

assemble_standalone() { # copy static + public beside the standalone server (Next leaves them out on purpose)
  for app in web admin; do
    local base="$release/apps/$app" out; out=$(standalone "$app")
    [[ -f "$out/server.js" ]] || die "missing $out/server.js — run build first"
    mkdir -p "$out/.next"
    rm -rf "$out/.next/static" "$out/public"
    cp -a "$base/.next/static" "$out/.next/"
    cp -a "$base/public" "$out/"
  done
}


previews_stop() { systemctl stop namilux-preview-web namilux-preview-admin 2>/dev/null || true; systemctl reset-failed namilux-preview-web namilux-preview-admin 2>/dev/null || true; }

case "$action" in
check-env)
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE is missing (copy infra/server/env.production.example)"
  [[ "$(stat -c '%a' "$ENV_FILE")" == 600 ]] || log "warning: $ENV_FILE should be mode 600 root:root (systemd reads it before dropping privileges)"
  src=$(readlink -f "$CURRENT" 2>/dev/null || ls -d "$RELEASES"/* 2>/dev/null | tail -1) || true
  [[ -n "$src" && -d "$src/packages/config" ]] || die "no release to validate with yet - run a fetch first"
  cd "$src/packages/config"
  set -a; source "$ENV_FILE"; set +a
  # Node 24 strips TypeScript types natively, so the schema module is imported as is (no tsx needed here)
  node --input-type=module -e 'import { parseEnv, webEnvSchema, adminEnvSchema, workerEnvSchema, EnvError } from "./src/env.ts";
    let bad = false;
    for (const [n, s] of [["web", webEnvSchema], ["admin", adminEnvSchema], ["worker", workerEnvSchema]]) {
      try { parseEnv(s); console.log(`ok   ${n}`); } catch (e) { bad = true; console.log(`FAIL ${n}`); if (e instanceof EnvError) for (const i of e.issues) console.log(`     ${i.path}: ${i.message}`); }
    }
    process.exit(bad ? 1 : 0);'
  ;;

set-env)
  # Change /opt/namilux/.env without a rebuild.
  #   release.sh set-env KEY=VALUE [KEY=VALUE …] [--no-check] [--force]
  #
  # NO rebuild needed: PAYMENT_DRIVER, SMS_DRIVER and their credentials, APP_ENV, CHECKOUT_ENABLED,
  # MAINTENANCE, SMS_PATTERNS, the backup/CDN/Telegram keys - every one of them is read at process
  # start, so a `restart` is the whole deployment.
  #
  # The file is rewritten line by line, never with `sed s#…#`: a credential may contain the delimiter
  # of any expression, and a mangled secret is a silent failure. Values are never printed or logged.
  shift                                     # drop the literal "set-env"; what is left are the pairs
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE is missing"
  declare -A NEW=()
  keys=(); force=0; check=1
  for a in "$@"; do
    case "$a" in
      --no-check) check=0; continue;;
      --force) force=1; continue;;
      -*) die "set-env: unknown option $a";;
    esac
    [[ "$a" == *=* ]] || die "set-env: expected KEY=VALUE, got '$a'"
    k=${a%%=*}; v=${a#*=}
    [[ "$k" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "set-env: '$k' is not an environment key (A-Z, 0-9, _)"
    [[ "$k" == NEXT_PUBLIC_BUILD_ID ]] && die "set-env: NEXT_PUBLIC_BUILD_ID is written by 'activate' on every switch - never by hand"
    # /opt/namilux/.env has TWO readers that disagree about unquoted values: systemd takes the line
    # literally, this script `source`s it for build/migrate/check-env. Unquoted, ZARINPAL_ACCESS_TOKEN=ab&cd
    # gives systemd "ab&cd" and the build "ab" - assigned in a background job, no error on either
    # side, half a secret baked into the release. Caught here, where it can still be pointed at a key.
    if [[ ! "$v" =~ ^\".*\"$ ]] && [[ ! "$v" =~ ^\'.*\'$ ]] &&
       printf '%s' "$v" | LC_ALL=C grep -q '[[:space:]&;|<>()$`\\"]'; then
      # Single quotes: systemd strips them and `source` keeps every character inside literal, which is
      # what a JSON value such as SMS_PATTERNS={"otp":"…"} needs (unquoted, bash would eat its quotes).
      [[ "$v" == *"'"* ]] && die "set-env: the value of $k holds both a single quote and a shell metacharacter - quote it yourself (nothing was changed)"
      v="'$v'"
    fi
    NEW[$k]=$v; keys+=("$k")
  done
  [[ ${#NEW[@]} -gt 0 ]] || die "set-env: nothing to set - release.sh set-env KEY=VALUE [KEY=VALUE …]"

  bak="$ENV_FILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a "$ENV_FILE" "$bak"
  tmp=$(mktemp); tmp2=$(mktemp); trap 'rm -f "$tmp" "$tmp2"' EXIT
  # pass 1 - every real `KEY=` line (a key written twice is replaced twice: systemd takes the last)
  declare -A seen=()
  : > "$tmp"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^([A-Z][A-Z0-9_]*)= ]] && [[ -v NEW[${BASH_REMATCH[1]}] ]]; then
      k=${BASH_REMATCH[1]}
      printf '%s=%s\n' "$k" "${NEW[$k]}" >> "$tmp"
      seen[$k]=1
      continue
    fi
    printf '%s\n' "$line" >> "$tmp"
  done < "$ENV_FILE"
  for k in "${!seen[@]}"; do unset "NEW[$k]"; done
  # pass 2 - keys that exist only commented out: CHECKOUT_ENABLED and MAINTENANCE ship that way, and
  if [[ ${#NEW[@]} -gt 0 ]]; then
    : > "$tmp2"
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ ^#[[:space:]]*([A-Z][A-Z0-9_]*)= ]] && [[ -v NEW[${BASH_REMATCH[1]}] ]]; then
        k=${BASH_REMATCH[1]}
        printf '%s=%s\n' "$k" "${NEW[$k]}" >> "$tmp2"
        unset "NEW[$k]"
        continue
      fi
      printf '%s\n' "$line" >> "$tmp2"
    done < "$tmp"
    cat "$tmp2" > "$tmp"
  fi
  # pass 3 - a key this file has never carried
  for k in "${!NEW[@]}"; do printf '%s=%s\n' "$k" "${NEW[$k]}" >> "$tmp"; done
  # `cat >` and not `install`: the inode, its owner and its mode (root:root 600) are kept as they are
  cat "$tmp" > "$ENV_FILE"
  log "set in $ENV_FILE: ${keys[*]}   (values not printed; previous file: $bak)"

  if [[ $check -eq 1 ]]; then
    if ! "$0" check-env; then
      if [[ $force -eq 1 ]]; then
        log "warning: check-env FAILED and --force was given - the new file is kept; $bak is the previous one"
      else
        cat "$bak" > "$ENV_FILE"
        die "check-env failed - $ENV_FILE restored from $bak, nothing changed. Fix the values and try again (or --force to keep them)."
      fi
    fi
  fi
  log "not live yet - the processes read the file at start-up:  $0 restart all"
  ;;

fetch)
  [[ -n "$name" ]] || die "release name required"
  [[ ! -d "$release" ]] || die "$release exists - pick a new name"
  mkdir -p "$release"
  live=$(readlink -f "$CURRENT" 2>/dev/null || true)
  if [[ -n "$live" && -d "$live/node_modules" ]]; then
    log "seeding node_modules from $(basename "$live")"
    cp -a "$live/node_modules" "$release/node_modules"
    for pkg in "$live"/apps/* "$live"/packages/* "$live"/tests; do
      [[ -d "$pkg/node_modules" ]] || continue
      rel=${pkg#"$live"/}
      mkdir -p "$release/$rel"; cp -a "$pkg/node_modules" "$release/$rel/node_modules"
    done
  fi
  log "unpacking source from stdin"
  tar -xzf - -C "$release"
  chown -R deploy:namilux "$release"
  log "fetched $release"
  ;;

install)
  cd "$release"
  live=$(readlink -f "$CURRENT" 2>/dev/null || true)
  if [[ -n "$live" && -f "$live/pnpm-lock.yaml" ]] && cmp -s "$live/pnpm-lock.yaml" pnpm-lock.yaml && [[ -d node_modules ]]; then
    log "lockfile unchanged - node_modules reused from the live release"
  else
    log "pnpm install (lockfile changed or first release) - registry: ${NPM_REGISTRY:-default}"
    [[ -n "${NPM_REGISTRY:-}" ]] && export npm_config_registry=$NPM_REGISTRY
    sudo -u deploy -H env PATH="$PATH" pnpm install --frozen-lockfile
  fi
  ;;

build)
  cd "$release"
  set -a; source "$ENV_FILE"; set +a
  mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
  small=0; [[ $mem_kb -lt 6000000 ]] && small=1
  heap=${BUILD_HEAP_MB:-$([[ $small -eq 1 ]] && echo 1536 || echo 2048)}
  export NEXT_PUBLIC_BUILD_ID=$name NODE_OPTIONS=--max-old-space-size=$heap NEXT_TELEMETRY_DISABLED=1
  # On a box under 6 GB the build shares memory with the live services: the admin and the worker are
  # paused while it runs (the storefront keeps serving) and started again afterwards, even on failure.
  paused=()
  maintenance_begin
  resume() {
    local u
    for u in "${paused[@]}"; do
      systemctl start "$u" || true
      maintenance_clear "$u"
    done
    flock -u 8
  }
  trap resume EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if [[ ${BUILD_PAUSE_SERVICES:-$small} -eq 1 ]]; then
    pausable=(namilux-admin namilux-worker)
    for u in "${pausable[@]}"; do
      if systemctl is-active --quiet "$u"; then
        maintenance_mark "$u"; paused+=("$u"); systemctl stop "$u"
      fi
    done
    [[ ${#paused[@]} -gt 0 ]] && log "paused ${paused[*]} for the build"
  fi
  [[ "$(readlink -f "$CURRENT")" != "$release" ]] || die 'never build the live release; clone it first'
  log "build web (heap ${heap} MB)"; nice -n 10 runuser -u deploy -- pnpm --filter @namilux/web build
  log "build admin";                  nice -n 10 runuser -u deploy -- pnpm --filter @namilux/admin build
  assemble_standalone
  python3 "$ROOT/bin/seal-release.py" "$release"
  resume; trap - EXIT INT TERM
  log "build done"
  ;;

clone)
  # A new release from the live one's source and node_modules (no tarball): for a rebuild with a
  # changed environment (cutover.sh) or a rebuild after a settings change.
  [[ -n "$name" ]] || die "release name required"
  [[ ! -d "$release" ]] || die "$release exists - pick a new name"
  live=$(readlink -f "$CURRENT" 2>/dev/null || true)
  [[ -n "$live" && -d "$live" ]] || die "no live release to clone"
  log "cloning $(basename "$live") → $name"
  mkdir -p "$release"
  # everything except the two build outputs (they are rebuilt) and the previews' state
  tar -C "$live" --exclude=./apps/web/.next --exclude=./apps/admin/.next -cf - . | tar -C "$release" -xf -
  chown -R deploy:namilux "$release"
  log "cloned"
  ;;

migrate)
  cd "$release"
  set -a; source "$ENV_FILE"; set +a
  log "pre-migrate backup"; BACKUP_PREFIX=pre "$ROOT/bin/backup.sh" --db-only || die "pre-migrate backup failed; not migrating"
  # migrate.ts refuses APP_ENV=prod without --yes; the pre-migrate dump above is the safety net.
  log "drizzle migrations"; runuser -u deploy -- pnpm db:migrate --yes
  log "role grants";        runuser -u deploy -- pnpm db:roles
  ;;

stage)
  previews_stop
  assemble_standalone
  python3 "$ROOT/bin/seal-release.py" "$release"
  for app in web admin; do
    port=3001; [[ "$app" == admin ]] && port=3101
    systemd-run --collect --unit="namilux-preview-$app" --property=User=namilux \
      --property=UnsetEnvironment=DATABASE_URL_MIGRATE \
      --property=MemoryHigh=650M --property=MemoryMax=900M --setenv=NODE_OPTIONS=--max-old-space-size=512 \
      --setenv=MALLOC_ARENA_MAX=2 --setenv=MEMORY_METRICS=1 \
      --property="WorkingDirectory=$(standalone "$app")" --property=EnvironmentFile="$ENV_FILE" \
      --setenv="PORT=$port" --setenv=HOSTNAME=127.0.0.1 --setenv=NODE_ENV=production --setenv="NEXT_PUBLIC_BUILD_ID=$name" /usr/bin/node "$(standalone "$app")/server.js"
  done
  probe 3001 /healthz/ready/; probe 3001 /; probe 3001 /shop/; probe 3101 /healthz/ready
  ;;

activate)
  [[ -f "$(standalone web)/server.js" && -f "$(standalone admin)/server.js" ]] || die "release is not built"
  previews_stop
  python3 "$ROOT/bin/seal-release.py" "$release"
  previous=$(readlink -f "$CURRENT" 2>/dev/null || true)
  [[ -n "$previous" ]] && echo "$previous" > "$RELEASES/.previous"
  ln -sfn "$release" "$CURRENT"
  set_build_id "$name"
  rollback_now() {
    log "activation failed - rolling back"
    bash "$release/infra/server/sync-units.sh" restore "$release/.unit-backup" || true
    [[ -n "$previous" ]] && { ln -sfn "$previous" "$CURRENT"; set_build_id "$(basename "$previous")"; }
    systemctl restart namilux-web namilux-admin namilux-worker
    previews_stop
  }
  trap rollback_now ERR
  bash "$release/infra/server/sync-units.sh" install "$release/infra/server/systemd" "$release/.unit-backup"
  systemctl restart namilux-worker
  systemctl restart namilux-web;   probe 3000 /healthz/ready/ 60; probe 3000 /; probe 3000 /shop/
  systemctl restart namilux-admin; probe 3100 /healthz/ready 60
  trap - ERR
  previews_stop
  # The server kit ships with the release; refresh the installed copies so the next deploy runs
  # this release's scripts (install() writes a new inode, so the running release.sh is unaffected).
  install -m 755 "$release"/infra/server/{release.sh,maintenance.sh,sync-units.sh,backup.sh,restore.sh,watchdog.sh,notify.sh,warm.sh,cutover.sh} "$ROOT/bin/" 2>/dev/null || log "warning: could not refresh $ROOT/bin from the release"
  install -m 755 "$release/infra/server/seal-release.py" "$ROOT/bin/"
  # Fill the page caches before the public sees the new process (best effort, never fatal).
  bash "$release/infra/server/warm.sh" 3000 || true
  # keep the last N releases (never the live one, never the previous one)
  mapfile -t old < <(ls -dt "$RELEASES"/*/ | sed 's#/$##' | grep -v -e "^$release$" -e "^${previous:-__none__}$" | tail -n +"$KEEP_RELEASES")
  for d in "${old[@]:-}"; do [[ -n "$d" ]] && { log "prune $(basename "$d")"; rm -rf "$d"; }; done
  systemctl is-active namilux-web namilux-admin namilux-worker
  log "active: $release (previous: ${previous:-none})"
  ;;

rollback)
  previous=$(cat "$RELEASES/.previous" 2>/dev/null || true)
  [[ -n "$previous" && -d "$previous" ]] || die "no previous release recorded"
  live=$(readlink -f "$CURRENT")
  bash "$live/infra/server/sync-units.sh" restore "$live/.unit-backup"
  ln -sfn "$previous" "$CURRENT"
  set_build_id "$(basename "$previous")"
  systemctl restart namilux-worker namilux-web namilux-admin
  probe 3000 /healthz/ 60; probe 3100 /healthz 60
  # both builds live inside the release directory, so the symlink above restored them together; this
  [[ -f "$previous/infra/server/warm.sh" ]] && bash "$previous/infra/server/warm.sh" 3000 || true
  log "rolled back to $previous"
  ;;

warm)
  # Re-fill the storefront caches by hand (after a restart, a settings change, a cold box).
  src=$(readlink -f "$CURRENT" 2>/dev/null || true)
  [[ -n "$src" && -f "$src/infra/server/warm.sh" ]] || die "no live release with warm.sh"
  bash "$src/infra/server/warm.sh" "${arg:-3000}"
  ;;

rebuild)
  # A new release from the live source with the environment AS IT IS NOW - what cutover.sh and
  # prerendered, so a changed SITE_ORIGIN is not live until the app has been built again.
  [[ -n "$name" ]] || die "release name required"
  "$0" "$name" clone
  "$0" "$name" migrate
  "$0" "$name" build
  "$0" "$name" activate
  ;;

restart)
  live=$(readlink -f "$CURRENT" 2>/dev/null || true)
  [[ -n "$live" && -d "$live" ]] || die "no live release"
  case "${arg:-all}" in
    web)         systemctl restart namilux-web; probe 3000 /healthz/ 60;;
    admin)       systemctl restart namilux-admin; probe 3100 /healthz 60;;
    worker)      systemctl restart namilux-worker;;
    all)         systemctl restart namilux-worker namilux-web namilux-admin
                 probe 3000 /healthz/ 60; probe 3100 /healthz 60;;
    *) die "restart: web | admin | worker | all";;
  esac
  log "restarted ${arg:-all}"
  ;;

all)
  "$0" "$name" fetch
  "$0" "$name" install
  # migrate BEFORE build: the build prerenders the catalogue against the live database, so every
  # column the new code selects must already exist (release r12 failed exactly there). Migrations are
  # additive, so the live release keeps running on the wider schema; the pre-migrate dump is the net.
  "$0" "$name" migrate
  "$0" "$name" build
  "$0" "$name" stage
  "$0" "$name" activate
  ;;

status)
  echo "current: $(readlink -f "$CURRENT" 2>/dev/null || echo none)"
  units=(namilux-web namilux-admin namilux-worker)
  systemctl --no-pager --lines=0 status "${units[@]}" caddy postgresql 2>/dev/null | grep -E 'Active|●' || true
  curl -s --max-time 5 -H "Host: $(site_host)" -H "X-Forwarded-Proto: https" http://127.0.0.1:3000/healthz/ && echo
  curl -s --max-time 5 http://127.0.0.1:3100/healthz && echo
  curl -s --max-time 5 http://127.0.0.1:3200/healthz && echo
  ;;

logs)
  unit=${arg:-web}
  journalctl -u "namilux-$unit" -n 200 --no-pager -o cat
  ;;

*) die "unknown action: $action";;
esac
