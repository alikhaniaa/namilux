#!/usr/bin/env bash
#
# Run ONCE as root on a fresh server (re-running is safe; every step checks before it changes):
#
#   curl -fsSL <raw-url>/infra/server/provision.sh -o provision.sh   # or scp it from the repo
#   bash provision.sh --site namilux.ir --admin admin.namilux.ir --acme-email ops@namilux.ir \
#        --admin-cidrs "1.2.3.4/32 5.6.7.0/24" --deploy-key ~/.ssh/authorized_keys
#
#   bash provision.sh --site 203.0.113.10            # a test box without a domain: self-signed TLS on the IP,
#                                                    # storefront on :443, admin on :8100 (Caddyfile.ip)
# Options
#   --site <host|ip>        the storefront hostname (or a bare IP for a test box)        [required]
#   --admin <host>          the admin hostname                                            [default admin.<site>]
#   --acme-email <mail>     Let's Encrypt contact                                         [default ops@<site>]
#   --admin-cidrs "<list>"  IPv4/IPv6 CIDRs allowed to reach the admin (space/comma sep.) [default: everyone]
#   --deploy-key <file>     public key(s) for the `deploy` user (the dev machine)          [default: root's authorized_keys]
#   --ssh-port <n>          move sshd to another port (ufw is updated first)               [default: keep 22]
#   --node-mirror <url>     Node.js dist mirror when nodejs.org is unreachable (README §7)
#   --skip-hardening        do not touch sshd / ufw / fail2ban (when a provider manages them)
#   --only-hardening        ONLY sshd / ufw / fail2ban / upgrades - for a box that is already running the
#                           apps (the demo server); installs nothing else and touches no config of theirs
#
# What it installs/configures: node 24 + pnpm 10, Caddy, PostgreSQL 16 (loopback, tuned), the
# `namilux` service user and `/opt/namilux` layout, `/opt/namilux/.env` from the template with fresh
# secrets and DB passwords, the systemd units + timers (backup, watchdog), ufw, fail2ban, unattended
# security upgrades, chrony, journald limits, sysctl, a swap file on small boxes.
set -euo pipefail

SITE=""; ADMIN=""; ACME_EMAIL=""; ADMIN_CIDRS=""; DEPLOY_KEY=""; SSH_PORT=""; NODE_MIRROR=""; SKIP_HARDENING=0; ONLY_HARDENING=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --site) SITE=$2; shift 2;;
    --admin) ADMIN=$2; shift 2;;
    --acme-email) ACME_EMAIL=$2; shift 2;;
    --admin-cidrs) ADMIN_CIDRS=$2; shift 2;;
    --deploy-key) DEPLOY_KEY=$2; shift 2;;
    --ssh-port) SSH_PORT=$2; shift 2;;
    --node-mirror) NODE_MIRROR=$2; shift 2;;
    --skip-hardening) SKIP_HARDENING=1; shift;;
    --only-hardening) ONLY_HARDENING=1; shift;;
    *) echo "unknown option $1"; exit 2;;
  esac
done
[[ -n "$SITE" || $ONLY_HARDENING -eq 1 ]] || { sed -n '7,32p' "$0"; exit 2; }
SITE=${SITE:-$(hostname -I 2>/dev/null | awk '{print $1}')}
[[ $EUID -eq 0 ]] || { echo "run as root"; exit 2; }
IP_MODE=0; [[ "$SITE" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && IP_MODE=1
[[ -n "$ADMIN" ]] || ADMIN="admin.$SITE"
[[ -n "$ACME_EMAIL" ]] || ACME_EMAIL="ops@$SITE"
NODE_MAJOR=24; PNPM_VERSION=10.15.0
ROOT=/opt/namilux
HERE=$(cd "$(dirname "$0")" && pwd)
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# -  -  - 1. packages -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
log "apt: base packages"
apt-get update -qq
if [[ $ONLY_HARDENING -eq 1 ]]; then
  apt-get install -y -qq --no-install-recommends ufw fail2ban unattended-upgrades chrony >/dev/null
else
apt-get install -y -qq --no-install-recommends \
  curl ca-certificates gnupg lsb-release git rsync jq age rclone ufw fail2ban unattended-upgrades \
  chrony xz-utils build-essential python3 debian-keyring debian-archive-keyring apt-transport-https \
  postgresql postgresql-client >/dev/null           # the release's default PostgreSQL (16 on 24.04, newer later)
PG_VER=$(ls /etc/postgresql 2>/dev/null | sort -V | tail -1)
[[ -n "$PG_VER" ]] || { echo "postgresql cluster directory not found"; exit 1; }

# -  -  - 2. node + pnpm -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
if ! have node || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt $NODE_MAJOR ]]; then
  log "node $NODE_MAJOR"
  if [[ -z "$NODE_MIRROR" ]] && curl -fsSL --max-time 20 "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource.sh; then
    bash /tmp/nodesource.sh >/dev/null && apt-get install -y -qq nodejs >/dev/null
  else
    base=${NODE_MIRROR:-https://nodejs.org/dist}
    ver=$(curl -fsSL "$base/index.json" | jq -r "[.[] | select(.version | startswith(\"v${NODE_MAJOR}.\"))][0].version")
    arch=$(dpkg --print-architecture); [[ "$arch" == amd64 ]] && arch=x64
    curl -fsSL "$base/$ver/node-$ver-linux-$arch.tar.xz" | tar -xJ -C /usr/local --strip-components=1
  fi
fi
[[ -x /usr/bin/node ]] || ln -sf "$(command -v node)" /usr/bin/node
log "pnpm $PNPM_VERSION via corepack"
corepack enable >/dev/null 2>&1 || true
corepack prepare "pnpm@$PNPM_VERSION" --activate >/dev/null 2>&1 || npm install -g "pnpm@$PNPM_VERSION" >/dev/null
node -v; pnpm -v

# -  -  - 3. caddy -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
if ! have caddy; then
  log "caddy"
  if curl -fsSL --max-time 20 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null; then
    curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  else
    echo "cloudsmith unreachable — downloading the caddy binary"
    curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$(dpkg --print-architecture)" -o /usr/bin/caddy
    chmod 755 /usr/bin/caddy
    groupadd --system caddy 2>/dev/null || true
    useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy 2>/dev/null || true
    cat > /etc/systemd/system/caddy.service <<'EOF'
[Unit]
Description=Caddy
After=network.target network-online.target
Requires=network-online.target
[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_BIND_SERVICE
[Install]
WantedBy=multi-user.target
EOF
  fi
fi
mkdir -p /etc/caddy /var/log/caddy && chown caddy:caddy /var/log/caddy

# -  -  - 4. users + layout -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
log "users and /opt/namilux"
id namilux >/dev/null 2>&1 || useradd --system --user-group --create-home --home-dir "$ROOT" --shell /usr/sbin/nologin namilux
id deploy  >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
usermod -a -G namilux deploy
mkdir -p "$ROOT"/{releases,backups,media,bin}
chown root:root "$ROOT" "$ROOT/releases"
chown namilux:namilux "$ROOT/media"
# useradd creates the home 750; caddy (another user) serves /opt/namilux/media and must be able to enter
chmod 755 "$ROOT" "$ROOT/releases" "$ROOT/bin" "$ROOT/media"
chown root:root "$ROOT/backups" "$ROOT/bin"; chmod 700 "$ROOT/backups"
install -m 755 "$HERE"/{release.sh,maintenance.sh,sync-units.sh,backup.sh,restore.sh,watchdog.sh,notify.sh,warm.sh,cutover.sh} "$ROOT/bin/"
install -m 755 "$HERE/seal-release.py" "$ROOT/bin/"
echo 'deploy ALL=(root) NOPASSWD: /opt/namilux/bin/release.sh' > /etc/sudoers.d/namilux-deploy && chmod 440 /etc/sudoers.d/namilux-deploy
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
if [[ -n "$DEPLOY_KEY" && -f "$DEPLOY_KEY" ]]; then cat "$DEPLOY_KEY" >> /home/deploy/.ssh/authorized_keys
elif [[ -f /root/.ssh/authorized_keys ]]; then cat /root/.ssh/authorized_keys >> /home/deploy/.ssh/authorized_keys; fi
[[ -f /home/deploy/.ssh/authorized_keys ]] && { sort -u -o /home/deploy/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys; chmod 600 /home/deploy/.ssh/authorized_keys; }
chown -R deploy:deploy /home/deploy/.ssh

# -  -  - 5. postgres -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
log "postgres $PG_VER (loopback, tuned, roles)"
install -m 644 "$HERE/postgres/namilux.conf" "/etc/postgresql/$PG_VER/main/conf.d/namilux.conf"
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
pgconf="/etc/postgresql/$PG_VER/main/conf.d/namilux.conf"
if [[ $mem_kb -lt 3000000 ]]; then      # 2 GB box
  sed -i -e 's/^shared_buffers = .*/shared_buffers = 512MB/' -e 's/^effective_cache_size = .*/effective_cache_size = 1200MB/' \
         -e 's/^work_mem = .*/work_mem = 8MB/' -e 's/^maintenance_work_mem = .*/maintenance_work_mem = 128MB/' "$pgconf"
elif [[ $mem_kb -lt 6000000 ]]; then    # 4 GB box: a quarter for shared buffers, half as the planner's cache estimate
  sed -i -e 's/^shared_buffers = .*/shared_buffers = 768MB/' -e 's/^effective_cache_size = .*/effective_cache_size = 2GB/' \
         -e 's/^work_mem = .*/work_mem = 8MB/' -e 's/^maintenance_work_mem = .*/maintenance_work_mem = 128MB/' "$pgconf"
fi                                      # 8 GB and up: the values in the file
systemctl enable --now postgresql >/dev/null
systemctl restart postgresql
pw() { openssl rand -base64 30 | tr -d '/+=' | cut -c1-28; }
PG_MIGRATE_PW=$(pw); PG_WEB_PW=$(pw); PG_ADMIN_PW=$(pw); PG_WORKER_PW=$(pw)
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='nl_migrate'" | grep -q 1; then
  sudo -u postgres psql -qc "CREATE ROLE nl_migrate LOGIN CREATEROLE PASSWORD '$PG_MIGRATE_PW';"
  NEW_DB=1
else
  NEW_DB=0
fi
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='namilux'" | grep -q 1 || sudo -u postgres createdb -O nl_migrate -E UTF8 --locale=C.UTF-8 --template=template0 namilux
# the app roles are created + granted by `pnpm db:roles` (packages/db/roles.sql) from the URLs in .env

# -  -  - 6. environment file -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
if [[ ! -f "$ROOT/.env" ]]; then
  log "writing $ROOT/.env from the template (fresh secrets)"
  scheme=https; site_origin="$scheme://$SITE"; admin_origin="$scheme://$ADMIN"
  [[ $IP_MODE -eq 1 ]] && admin_origin="https://$SITE:8100"
  sed -e "s#^SITE_ORIGIN=.*#SITE_ORIGIN=$site_origin#" \
      -e "s#^ADMIN_ORIGIN=.*#ADMIN_ORIGIN=$admin_origin#" \
      -e "s#^APP_ENV=.*#APP_ENV=$([[ $IP_MODE -eq 1 ]] && echo staging || echo prod)#" \
      -e "s#^ADMIN_ALLOWED_CIDRS=.*#ADMIN_ALLOWED_CIDRS=$(echo "$ADMIN_CIDRS" | tr ' ' ',')#" \
      -e "s#nl_web:CHANGE_ME#nl_web:$PG_WEB_PW#" -e "s#nl_admin:CHANGE_ME#nl_admin:$PG_ADMIN_PW#" \
      -e "s#nl_worker:CHANGE_ME#nl_worker:$PG_WORKER_PW#" -e "s#nl_migrate:CHANGE_ME#nl_migrate:$PG_MIGRATE_PW#" \
      -e "s#^SESSION_PEPPER=.*#SESSION_PEPPER=$(openssl rand -hex 32)#" -e "s#^OTP_PEPPER=.*#OTP_PEPPER=$(openssl rand -hex 32)#" \
      -e "s#^QUOTE_SIGNING_KEY=.*#QUOTE_SIGNING_KEY=$(openssl rand -hex 32)#" -e "s#^INTERNAL_SIGNING_KEY=.*#INTERNAL_SIGNING_KEY=$(openssl rand -hex 32)#" \
      -e "s#^TOTP_ENC_KEY=.*#TOTP_ENC_KEY=$(openssl rand -hex 32)#" \
      "$HERE/env.production.example" > "$ROOT/.env"
  if [[ $IP_MODE -eq 1 ]]; then  # a test box may run the mock drivers (APP_ENV=staging allows them)
    sed -i -e 's#^PAYMENT_DRIVER=.*#PAYMENT_DRIVER=mock#' -e 's#^SMS_DRIVER=.*#SMS_DRIVER=mock#' "$ROOT/.env"
  fi
  # systemd reads the file as the service manager and release.sh sources it as root: nobody else needs it
  chown root:root "$ROOT/.env"; chmod 600 "$ROOT/.env"
  [[ $NEW_DB -eq 1 ]] || echo "NOTE: nl_migrate existed already — set its real password in $ROOT/.env (DATABASE_URL_MIGRATE)"
else
  log "$ROOT/.env exists — left untouched"
  [[ $NEW_DB -eq 1 ]] && echo "NOTE: new nl_migrate password is $PG_MIGRATE_PW — put it into DATABASE_URL_MIGRATE"
fi

# -  -  - 7. caddy config -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
log "caddy config"
cat > /etc/caddy/namilux.env <<EOF
SITE_HOST=$SITE
ADMIN_HOST=$ADMIN
ACME_EMAIL=$ACME_EMAIL
ADMIN_ALLOWED_CIDRS=${ADMIN_CIDRS:-0.0.0.0/0 ::/0}
CDN_TRUSTED_RANGES=private_ranges
EOF
chmod 640 /etc/caddy/namilux.env; chown root:caddy /etc/caddy/namilux.env
# Optional deployment-specific virtual hosts are loaded from this directory.
# instead of being edited into the Caddyfile, so a cutover can reinstall that file without losing them.
# An empty directory is fine: an import glob that matches nothing is a warning, not an error.
mkdir -p /etc/caddy/sites
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=/etc/caddy/namilux.env\n' > /etc/systemd/system/caddy.service.d/namilux.conf
if [[ $IP_MODE -eq 1 ]]; then
  install -m 644 "$HERE/caddy/Caddyfile.ip" /etc/caddy/Caddyfile
  if [[ ! -f /etc/caddy/ip.crt ]]; then
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 730 \
      -keyout /etc/caddy/ip.key -out /etc/caddy/ip.crt -subj "/CN=$SITE" -addext "subjectAltName=IP:$SITE" 2>/dev/null
    chown caddy:caddy /etc/caddy/ip.key /etc/caddy/ip.crt; chmod 600 /etc/caddy/ip.key
  fi
else
  install -m 644 "$HERE/caddy/Caddyfile" /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
# validate runs as root and opens the log writers, leaving root-owned files the caddy user cannot open
chown -R caddy:caddy /var/log/caddy
systemctl daemon-reload; systemctl enable --now caddy >/dev/null; systemctl restart caddy

# -  -  - 8. systemd units + timers -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
log "systemd units"
install -m 644 "$HERE"/systemd/namilux-*.service "$HERE"/systemd/namilux-*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable namilux-web namilux-admin namilux-worker >/dev/null        # started by the first release.sh activate
systemctl enable --now namilux-backup.timer namilux-watchdog.timer >/dev/null

fi  # end of the full install (only-hardening skips sections 2–8)
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)

# -  -  - 9. OS: swap, sysctl, journald, time, upgrades -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
log "kernel, journald, swap, time sync, unattended upgrades"
cat > /etc/sysctl.d/90-namilux.conf <<'EOF'
net.ipv4.tcp_syncookies = 1
net.core.somaxconn = 4096
net.ipv4.ip_local_port_range = 10240 65000
net.ipv4.tcp_fin_timeout = 20
net.ipv4.tcp_tw_reuse = 1
fs.file-max = 1048576
vm.swappiness = 10
vm.overcommit_memory = 1
EOF
sysctl -q --system >/dev/null
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=1G\nMaxRetentionSec=30day\n' > /etc/systemd/journald.conf.d/namilux.conf
systemctl restart systemd-journald
if [[ $mem_kb -lt 8000000 ]] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
[[ $ONLY_HARDENING -eq 0 ]] && { timedatectl set-timezone UTC >/dev/null 2>&1 || true; }
systemctl enable --now chrony >/dev/null 2>&1 || true
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
sed -i 's#^//\s*"${distro_id}:${distro_codename}-security";#        "${distro_id}:${distro_codename}-security";#' /etc/apt/apt.conf.d/50unattended-upgrades 2>/dev/null || true

# -  -  - 10. hardening: sshd, ufw, fail2ban -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
if [[ $SKIP_HARDENING -eq 0 ]]; then
  log "sshd, ufw, fail2ban"
  port=${SSH_PORT:-$(grep -E '^Port ' /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' | head -1 || true)}; port=${port:-22}
  if [[ -s /root/.ssh/authorized_keys || -s /home/deploy/.ssh/authorized_keys ]]; then
    cat > /etc/ssh/sshd_config.d/90-namilux.conf <<EOF
Port $port
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
MaxAuthTries 3
LoginGraceTime 20
X11Forwarding no
AllowTcpForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
    sshd -t && systemctl reload ssh || systemctl reload sshd || true
  else
    echo "no authorized_keys found — password login left enabled (add a key, then re-run)"
  fi
  ufw --force reset >/dev/null
  ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null
  ufw limit "$port"/tcp >/dev/null
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  [[ $IP_MODE -eq 1 ]] && ufw allow 8100/tcp >/dev/null
  ufw --force enable >/dev/null
  cat > /etc/fail2ban/jail.d/namilux.local <<EOF
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd
[sshd]
enabled = true
port    = $port
EOF
  # the admin-scanner jail only when this box writes the Caddy admin log (the kit's Caddyfiles do)
  if [[ -f /var/log/caddy/admin.log ]]; then
    cat >> /etc/fail2ban/jail.d/namilux.local <<'EOF'
[caddy-admin-404]
enabled  = true
port     = http,https,8100
filter   = caddy-admin-404
logpath  = /var/log/caddy/admin.log
maxretry = 20
findtime = 5m
bantime  = 6h
EOF
  fi
  cat > /etc/fail2ban/filter.d/caddy-admin-404.conf <<'EOF'
# Repeated 404s on the admin hostname = a scanner or an address outside the allow-list probing.
[Definition]
failregex = ^.*"client_ip":"<HOST>".*"status":404.*$
ignoreregex =
EOF
  systemctl enable --now fail2ban >/dev/null; systemctl restart fail2ban
fi

# -  -  - done -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
log "provisioned"
cat <<EOF
Host:        $SITE  (admin: $ADMIN)$( [[ $IP_MODE -eq 1 ]] && echo '  [IP mode: self-signed TLS, admin on :8100]')
Layout:      $ROOT/{releases,current,media,backups,bin}   env: $ROOT/.env (root:root 600)$( [[ $ONLY_HARDENING -eq 1 ]] && echo '  [hardening only — nothing else touched]')
Services:    namilux-web :3000 · namilux-admin :3100 · namilux-worker :3200 · caddy · postgresql (loopback)
Timers:      namilux-backup (03:30 Tehran) · namilux-watchdog (1 min)

Next (from the dev machine, see infra/server/README.md §3):
  1. fill the remaining values in $ROOT/.env (payment, SMS, Telegram, backup key) — then:  $ROOT/bin/release.sh check-env
  2. infra/server/deploy-from-local.sh deploy@$SITE            # first release: fetch → install → build → migrate → stage → activate
  3. on the server:  cd $ROOT/current && runuser -u namilux -- pnpm db:seed     (legacy import, once)
                     cd $ROOT/current && runuser -u namilux -- pnpm admin:create-owner --email owner@…
EOF
