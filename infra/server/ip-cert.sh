#!/usr/bin/env bash
# A real (Let's Encrypt) certificate for a box that is reached by its bare IP - no browser warning
# while the domain still points elsewhere. Let's Encrypt issues IP certificates only in the
# short-lived profile (6 days), so certbot renews twice a day and hands the files to Caddy.
#
#   ip-cert.sh <ip>            obtain (or renew) and install; idempotent, safe to re-run
#
# Needs: Caddyfile.ip live (its :80 block proxies /.well-known/acme-challenge/* to :8085), port 80
# open, and a certbot new enough for IP names (≥ 4.1) - the distribution package is older, so
# certbot is installed into its own virtualenv from PyPI (set PIP_INDEX_URL to a mirror if needed).
set -euo pipefail
IP=${1:?usage: ip-cert.sh <ip>}
[[ $EUID -eq 0 ]] || { echo "run as root"; exit 2; }
VENV=/opt/certbot-venv
CERTBOT=$VENV/bin/certbot
HOOK=/opt/namilux/bin/ip-cert-deploy.sh
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# -  -  - 1. certbot in a virtualenv -  -  - 
if [[ ! -x $CERTBOT ]]; then
  log "installing certbot into $VENV"
  apt-get install -y -qq --no-install-recommends python3-venv >/dev/null
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q certbot
fi
"$CERTBOT" --version

# -  -  - 2. the deploy hook: copy the lineage into /etc/caddy and reload, rolling back on a bad config -  -  - 
cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
# certbot deploy hook - install the renewed IP certificate for Caddy (never gives Caddy the ACME account)
set -euo pipefail
src=${RENEWED_LINEAGE:?RENEWED_LINEAGE not set}
install -o root -g caddy -m 0640 "$src/privkey.pem" /etc/caddy/ip.key.new
install -o root -g caddy -m 0644 "$src/fullchain.pem" /etc/caddy/ip.crt.new
cp -p /etc/caddy/ip.key /etc/caddy/ip.key.previous 2>/dev/null || true
cp -p /etc/caddy/ip.crt /etc/caddy/ip.crt.previous 2>/dev/null || true
mv /etc/caddy/ip.key.new /etc/caddy/ip.key
mv /etc/caddy/ip.crt.new /etc/caddy/ip.crt
if caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 && systemctl reload caddy; then
  logger -t namilux-ipcert "certificate for $(basename "$src") installed"
else
  [[ -f /etc/caddy/ip.key.previous ]] && cp -p /etc/caddy/ip.key.previous /etc/caddy/ip.key
  [[ -f /etc/caddy/ip.crt.previous ]] && cp -p /etc/caddy/ip.crt.previous /etc/caddy/ip.crt
  systemctl reload caddy || true
  logger -t namilux-ipcert "reload failed - previous certificate restored"
  exit 1
fi
EOF
chmod 755 "$HOOK"

# -  -  - 3. obtain (first run) or renew -  -  - 
if [[ -d /etc/letsencrypt/live/$IP ]]; then
  log "renewing (if due)"
  "$CERTBOT" -q renew --no-random-sleep-on-renew || true
  RENEWED_LINEAGE=/etc/letsencrypt/live/$IP "$HOOK"
else
  log "requesting the certificate for $IP"
  "$CERTBOT" certonly --non-interactive --agree-tos --register-unsafely-without-email \
    --standalone --http-01-port 8085 --preferred-profile shortlived --key-type ecdsa \
    --deploy-hook "$HOOK" --cert-name "$IP" --ip-address "$IP"
fi
openssl x509 -in /etc/caddy/ip.crt -noout -issuer -dates

# -  -  - 4. renew twice a day (the certificate lives six days) -  -  - 
cat > /etc/systemd/system/certbot-ip.service <<EOF
[Unit]
Description=Renew the Let's Encrypt IP certificate for Caddy
After=network-online.target
[Service]
Type=oneshot
ExecStart=$CERTBOT -q renew --no-random-sleep-on-renew
EOF
cat > /etc/systemd/system/certbot-ip.timer <<'EOF'
[Unit]
Description=Renew the Let's Encrypt IP certificate twice a day
[Timer]
OnCalendar=*-*-* 03,15:17:00
RandomizedDelaySec=20min
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now certbot-ip.timer >/dev/null
log "done - https://$IP serves a Let's Encrypt certificate; certbot-ip.timer renews it"
