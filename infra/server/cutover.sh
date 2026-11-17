#!/usr/bin/env bash
# Move a box that was provisioned in IP mode (self-signed TLS on the address, staging environment,
# mock payment/SMS) to the real hostnames. Run as root AFTER the DNS records of the site and the
# admin host point at this box. In order:
#   1. rewrites SITE_ORIGIN / ADMIN_ORIGIN / APP_ENV in /opt/namilux/.env  (APP_ENV: --app-env, default prod)
#   2. validates the environment with the app's own schema - in prod that refuses the mock drivers, so
#      ZARINPAL_MERCHANT_ID, SMS_API_KEY and SMS_SENDER must already be filled in (the script stops
#      here otherwise). --app-env staging keeps the mock drivers legal: the domain goes live before
#      the credentials do, and then CHECKOUT MUST BE OFF (see 2b).
#   2b. --app-env staging only: reads commerce.checkout_enabled out of the database and REFUSES to go
#      on while online checkout is still on - a mock gateway on the real domain settles every order
#      for free. Turn it off in the admin first, or pass --force.
#   3. rebuilds the live release as a new release: migrate first, then build - the build prerenders
#      the catalogue against the live database (release r12 failed the other way round) - and canonical
#      URLs, sitemaps and JSON-LD are prerendered with the origin baked in, so a rebuild is not optional
#   4. installs the production Caddyfile with the hostnames (Let's Encrypt certificates are issued
#      on the first request), closes the :8100 test port, activates the new release
# - extra vhosts survive: they live in /etc/caddy/sites/*.caddy, which that file imports
#
#   cutover.sh --site namilux.ir --admin admin.namilux.ir --acme-email ops@namilux.ir \
#              [--app-env staging|prod] [--admin-cidrs "1.2.3.4/32 5.6.7.0/24"] [--force]
set -euo pipefail
ROOT=/opt/namilux
ENV_FILE=$ROOT/.env
SITE=""; ADMIN=""; ACME_EMAIL=""; ADMIN_CIDRS=""; FORCE=0; APP_ENV_TARGET=prod
while [[ $# -gt 0 ]]; do
  case "$1" in
    --site) SITE=$2; shift 2;;
    --admin) ADMIN=$2; shift 2;;
    --acme-email) ACME_EMAIL=$2; shift 2;;
    --app-env) APP_ENV_TARGET=$2; shift 2;;
    --admin-cidrs) ADMIN_CIDRS=$2; shift 2;;
    --force) FORCE=1; shift;;
    *) echo "unknown option $1"; exit 2;;
  esac
done
[[ -n "$SITE" ]] || { sed -n '2,21p' "$0"; exit 2; }
[[ $EUID -eq 0 ]] || { echo "run as root"; exit 2; }
[[ "$APP_ENV_TARGET" == staging || "$APP_ENV_TARGET" == prod ]] || { echo "--app-env is staging or prod (default prod)"; exit 2; }
ADMIN=${ADMIN:-admin.$SITE}
ACME_EMAIL=${ACME_EMAIL:-ops@$SITE}
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
loud() { printf '\033[1;31m%s\033[0m\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

# A value out of the env file. Never used for a secret - only for the driver names printed below.
env_get() { sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | tail -1 | tr -d "\"'"; }

live=$(readlink -f "$ROOT/current" 2>/dev/null || true)
[[ -n "$live" && -d "$live" ]] || die "no live release - deploy once before the cutover"
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE is missing"

# -  -  - 0. DNS must already point here (a rebuild against the wrong origin is expensive) -  -  - 
myip=$(curl -4 -s --max-time 10 https://ifconfig.me || hostname -I | awk '{print $1}')
for h in "$SITE" "$ADMIN"; do
  resolved=$(getent ahostsv4 "$h" | awk '{print $1}' | sort -u | tr '\n' ' ')
  if [[ " $resolved " != *" $myip "* ]]; then
    echo "WARNING: $h resolves to [${resolved:-nothing}], this box is $myip"
    [[ $FORCE -eq 1 ]] || die "fix the DNS first, or pass --force"
  fi
done

# -  -  - 1. environment -  -  - 
log "environment → https://$SITE (admin https://$ADMIN), APP_ENV=$APP_ENV_TARGET"
cp -a "$ENV_FILE" "$ENV_FILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"
sed -i -e "s#^SITE_ORIGIN=.*#SITE_ORIGIN=https://$SITE#" \
       -e "s#^ADMIN_ORIGIN=.*#ADMIN_ORIGIN=https://$ADMIN#" \
       -e "s#^APP_ENV=.*#APP_ENV=$APP_ENV_TARGET#" \
       -e "s#^ADMIN_ALLOWED_CIDRS=.*#ADMIN_ALLOWED_CIDRS=$(echo "$ADMIN_CIDRS" | tr ' ' ',')#" \
       -e "s#^ADMIN_TOTP_DISABLED=.*#ADMIN_TOTP_DISABLED=0#" "$ENV_FILE"
grep -q '^ADMIN_TOTP_DISABLED=' "$ENV_FILE" || true

# -  -  - 2. the app's own validation: prod refuses mock drivers and a dev build id; staging does not -  -  - 
log "validating the environment"
if ! "$ROOT/bin/release.sh" check-env; then
  die "the environment is not valid for APP_ENV=$APP_ENV_TARGET - fix it in $ENV_FILE and run this again (the previous file is kept as $ENV_FILE.bak-*)"
fi

pay=$(env_get PAYMENT_DRIVER); sms=$(env_get SMS_DRIVER)
mocks=""
[[ "$pay" == mock ]] && mocks="PAYMENT_DRIVER=mock"
[[ "$sms" == mock ]] && mocks="${mocks:+$mocks, }SMS_DRIVER=mock"

# -  -  - 2b. staging on a real domain: online checkout has to be OFF -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
# The mock gateway is "always eligible, settles at once": with checkout on, a stranger who finds the
# domain places a real order the shop then owes. Read the switch that actually decides - core's
# placeOrder reads effectiveFlags(settings, {}), i.e. settings["commerce.checkout_enabled"] ONLY; the
# CHECKOUT_ENABLED variable in the env file is not consulted there (docs/launch-runbook.md).
# No row at all = the schema default, which is ON.
checkout_row() { sudo -u postgres psql -tAqX -d namilux -c \
  "select value_json::text from settings where key = 'commerce.checkout_enabled'" 2>/dev/null; }
if [[ "$APP_ENV_TARGET" == staging ]]; then
  log "checkout switch (staging + mock drivers on a public hostname)"
  if state=$(checkout_row); then
    state=$(echo "$state" | tr -d '[:space:]')
    case "$state" in
      false) echo "    commerce.checkout_enabled = false - online checkout is off. Good.";;
      true|"")
        loud "    commerce.checkout_enabled = ${state:-<no row: the default is TRUE>} - ONLINE CHECKOUT IS ON."
        loud "    $SITE would take real orders through ${pay:-?}, which settles every payment for free."
        echo "    Turn it off first, in the admin: /settings/commerce → «فعال بودن خرید آنلاین» → off"
        echo "    or, without the admin:"
        echo "      sudo -u postgres psql -d namilux -c \"insert into settings(key,value_json) values('commerce.checkout_enabled','false'::jsonb) on conflict (key) do update set value_json = excluded.value_json\""
        echo "      (every process picks it up within 30 s - core SETTINGS_CACHE_TTL_MS)"
        [[ $FORCE -eq 1 ]] || die "checkout is still on; turn it off and run this again, or pass --force";;
      *) warn "    commerce.checkout_enabled = $state - unexpected value, check it by hand";;
    esac
  else
    warn "    could not read the setting (psql/peer auth) - CHECK BY HAND that online checkout is off"
    [[ $FORCE -eq 1 ]] || die "cannot prove checkout is off; check it and pass --force"
  fi
fi

# -  -  - 3. rebuild with the new origin -  -  - 
# migrate BEFORE build: the build prerenders the catalogue against the live database, so every column
# the code selects must already exist (r12 failed exactly there). Same order as release.sh `rebuild`.
name="cutover-$(date -u +%Y%m%d-%H%M)"
log "rebuilding the live release as $name"
"$ROOT/bin/release.sh" "$name" clone
"$ROOT/bin/release.sh" "$name" migrate
"$ROOT/bin/release.sh" "$name" build

# -  -  - 4. edge: hostnames, production Caddyfile, close the test port -  -  - 
log "caddy → $SITE / $ADMIN"
cat > /etc/caddy/namilux.env <<EOF
SITE_HOST=$SITE
ADMIN_HOST=$ADMIN
ACME_EMAIL=$ACME_EMAIL
ADMIN_ALLOWED_CIDRS=${ADMIN_CIDRS:-0.0.0.0/0 ::/0}
CDN_TRUSTED_RANGES=private_ranges
EOF
chmod 640 /etc/caddy/namilux.env; chown root:caddy /etc/caddy/namilux.env
cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.ip-mode.bak"
install -m 644 "$live/infra/server/caddy/Caddyfile" /etc/caddy/Caddyfile
mkdir -p /etc/caddy/sites          # the production file imports /etc/caddy/sites/*.caddy
# namilux.env is a systemd EnvironmentFile, NOT a shell script: ADMIN_ALLOWED_CIDRS holds a
# space-separated list, so `source` would try to run "::/0" and take the cutover down with it.
while IFS='=' read -r k v; do
  [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
  export "$k=$v"
done < /etc/caddy/namilux.env
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || { install -m 644 /etc/caddy/Caddyfile.ip-mode.bak /etc/caddy/Caddyfile; die "Caddyfile invalid - restored the IP-mode file"; }
chown -R caddy:caddy /var/log/caddy   # validate ran as root and opened the log writers
systemctl restart caddy
ufw delete allow 8100/tcp >/dev/null 2>&1 || true
# the IP certificate (ip-cert.sh) is no longer needed: Caddy manages the domain certificates itself
systemctl disable --now certbot-ip.timer >/dev/null 2>&1 || true

# -  -  - 5. activate (restarts the services with the new environment) -  -  - 
PROBE_HOST=$SITE "$ROOT/bin/release.sh" "$name" activate

cat <<EOF

Cutover done - APP_ENV=$APP_ENV_TARGET.
  storefront  https://$SITE            admin  https://$ADMIN
  rollback    $ROOT/bin/release.sh $name rollback   (and restore $ENV_FILE.bak-* + /etc/caddy/Caddyfile.ip-mode.bak)
EOF

if [[ "$APP_ENV_TARGET" == staging ]]; then
  loud "
  ────────────────────────────────────────────────────────────────────────────
  STAGING ENVIRONMENT ON A PUBLIC HOSTNAME. Simulated drivers: ${mocks:-none}.
  ────────────────────────────────────────────────────────────────────────────"
  cat <<EOF
  · ONLINE CHECKOUT MUST STAY OFF while PAYMENT_DRIVER=mock. The mock gateway is always eligible and
    settles instantly: an order placed against it is owed by the shop and was never paid.
    The only switch that closes the shop is the ADMIN SETTING commerce.checkout_enabled - the
    CHECKOUT_ENABLED variable in $ENV_FILE is NOT read on the place-order path (docs/launch-runbook.md).
  · SMS_DRIVER=mock writes the login code to the journal and to $ROOT/.sms-outbox.jsonl instead of
    sending it. No real phone receives a code, so no shopper can log in - and checkout needs a login.
  · Indexing is NOT affected by APP_ENV: robots.txt, canonicals and sitemaps follow SITE_MODE and
    SITE_ORIGIN only. https://$SITE is a fully indexable site from this moment.
  · Nothing else about staging is weaker: https, TRUST_PROXY, the build id and the admin's TOTP are
    all enforced exactly as in prod (packages/config/src/env.ts). One exception to know about:
    the storefront's in-process rate limits are 50x wider while SMS_DRIVER=mock (apps/web ratelimit.ts).
  Flip to production later WITHOUT a rebuild (the origin does not change):
    $ROOT/bin/release.sh set-env PAYMENT_DRIVER=zarinpal ZARINPAL_MERCHANT_ID=<uuid> APP_ENV=prod
    $ROOT/bin/release.sh restart all
EOF
fi

cat <<EOF
Check now: the certificate (curl -sI https://$SITE | head -1), https://$SITE/ and /shop/, the admin
login on https://$ADMIN, and - in staging - that /billing/ shows «پرداخت آنلاین موقتاً غیرفعال است».
EOF
