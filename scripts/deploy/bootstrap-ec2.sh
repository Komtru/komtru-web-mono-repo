#!/usr/bin/env bash
#
# One-time preparation of an Ubuntu EC2 instance to run the Komtru backend.
#
#   sudo bash scripts/deploy/bootstrap-ec2.sh
#
# Idempotent: running it again upgrades what it installed and leaves the rest alone. It installs
# no application secrets and starts no application — deploy.sh does that.
#
# What it sets up:
#   1. Node 22, pnpm, PM2, git, curl, Apache (or nginx), and Redis unless Redis is managed
#   2. the unprivileged service account and /srv/komtru
#   3. the RDS CA bundle, because POSTGRES_CA_CERT is a path to a PEM and RDS requires one
#   4. the reverse-proxy vhost, with the WebSocket upgrade Socket.IO needs
#   5. PM2 under systemd, with an explicit PM2_HOME so the process list survives a reboot
#
# Tested end to end on Ubuntu 24.04 and Amazon Linux 2023, both x86_64. The two differ in more
# than their package manager — the names of the Redis and Apache packages, the names of their
# services, where a vhost goes, and whether `a2enmod` exists at all — so those are resolved once,
# into the variables below, rather than branched on at each use.
set -euo pipefail

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ ${EUID} -eq 0 ]] || die "run this with sudo."
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

APP_HOME="${APP_HOME:-/srv/komtru}"
CONF_FILE="${CONF_FILE:-${APP_HOME}/deploy.conf}"
if [[ -f ${CONF_FILE} ]]; then
  log "reading ${CONF_FILE}"
  set -a
  # shellcheck source=/dev/null
  . "${CONF_FILE}"
  set +a
fi

APP_USER="${APP_USER:-komtru}"
APP_HOME="${APP_HOME:-/srv/komtru}"
APP_DIR="${APP_DIR:-${APP_HOME}/app}"
PM2_HOME="${PM2_HOME:-${APP_HOME}/.pm2}"
NODE_MAJOR="${NODE_MAJOR:-22}"
PNPM_VERSION="${PNPM_VERSION:-10.18.2}"
REDIS_MODE="${REDIS_MODE:-native}"
WEB_SERVER="${WEB_SERVER:-apache}"
API_DOMAIN="${API_DOMAIN:-staging-api.komtru.com}"
API_PORT="${API_PORT:-7813}"
TLS_EMAIL="${TLS_EMAIL:-}"
POSTGRES_CA_BUNDLE="${POSTGRES_CA_BUNDLE:-${APP_HOME}/certs/rds-global-bundle.pem}"
SWAP_SIZE_MB="${SWAP_SIZE_MB:-1024}"
LOGROTATE_MAX_SIZE="${LOGROTATE_MAX_SIZE:-50M}"

[[ -r /etc/os-release ]] || die "cannot read /etc/os-release; unsupported image."
# shellcheck source=/dev/null
. /etc/os-release
case "${ID}" in
  ubuntu|debian)
    PKG=apt
    REDIS_PKGS=(redis-server); REDIS_SVC=redis-server
    HTTPD_PKGS=(apache2 python3-certbot-apache certbot); HTTPD_SVC=apache2
    HTTPD_SITE=/etc/apache2/sites-available/komtru-api.conf
    HTTPD_LOG_DIR='${APACHE_LOG_DIR}'
    ;;
  amzn|rhel|fedora|centos|rocky|almalinux)
    PKG=dnf
    # Amazon Linux 2023 ships Redis as `redis6`; there is no plain `redis` package.
    REDIS_PKGS=(redis6); REDIS_SVC=redis6
    # `mod_ssl` is a separate package here, and the vhost template's SSLEngine lines are a config
    # error without it.
    HTTPD_PKGS=(httpd mod_ssl python3-certbot-apache certbot); HTTPD_SVC=httpd
    # No sites-available/sites-enabled split: httpd includes every *.conf in conf.d.
    HTTPD_SITE=/etc/httpd/conf.d/komtru-api.conf
    HTTPD_LOG_DIR=/var/log/httpd
    ;;
  *) die "unsupported distribution '${ID}'." ;;
esac
log "host: ${PRETTY_NAME:-${ID}} on $(uname -m) (${PKG})"

pkg_install() {
  case "${PKG}" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" ;;
    dnf) dnf install -y "$@" ;;
  esac
}

# apt refuses to work while unattended-upgrades holds the dpkg lock, and on a freshly booted
# instance it very often does. Wait rather than fail six steps into a bootstrap.
wait_for_dpkg_lock() {
  [[ ${PKG} == apt ]] || return 0
  for _ in $(seq 1 60); do
    fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || return 0
    sleep 10
  done
  die "dpkg lock still held after 10 minutes; is unattended-upgrades stuck?"
}

log "refreshing package metadata"
wait_for_dpkg_lock
case "${PKG}" in
  apt) DEBIAN_FRONTEND=noninteractive apt-get update -y ;;
  dnf) dnf makecache -y ;;
esac

# curl is NOT present on a minimal Ubuntu cloud image, and both the NodeSource key and the RDS
# bundle are fetched with it.
#
# It is only asked for when it is actually missing. Amazon Linux 2023 ships `curl-minimal`, which
# provides a perfectly good /usr/bin/curl but CONFLICTS with the full `curl` package — naming curl
# unconditionally makes dnf print several hundred lines of conflict and give up before anything is
# installed.
log "installing base packages"
wait_for_dpkg_lock
BASE_PKGS=(ca-certificates gnupg git rsync jq openssl)
command -v curl >/dev/null || BASE_PKGS+=(curl)
pkg_install "${BASE_PKGS[@]}"

# ---------------------------------------------------------------------------
# Node 22. NodeSource publishes x86_64 and aarch64, so Graviton needs no special case, and
# @node-rs/argon2 — the only native dependency — ships prebuilt binaries for both.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && node -v | grep -q "^v${NODE_MAJOR}\."; then
  log "Node ${NODE_MAJOR} already installed ($(node -v))"
else
  log "installing Node ${NODE_MAJOR} from NodeSource"
  case "${PKG}" in
    apt)
      install -d -m 0755 /etc/apt/keyrings
      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
      echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list
      wait_for_dpkg_lock
      DEBIAN_FRONTEND=noninteractive apt-get update -y
      pkg_install nodejs
      ;;
    dnf)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      pkg_install nodejs
      ;;
  esac
fi
node -v | grep -q "^v${NODE_MAJOR}\." || die "expected Node ${NODE_MAJOR}, found $(node -v)."

log "enabling corepack and pinning pnpm ${PNPM_VERSION}"
corepack enable
corepack prepare "pnpm@${PNPM_VERSION}" --activate
# `pnpm -v` outside a project may still report a newer version; inside the repo, corepack honours
# the root package.json "packageManager" field, which is what the build actually uses.

log "installing PM2"
npm install -g pm2@latest >/dev/null
pm2 -v

# ---------------------------------------------------------------------------
# Redis. Loopback only, append-only, and noeviction — Redis here is not just a cache: BullMQ job
# state lives in it, and evicting a queue key loses queued notifications and ledger work.
# ---------------------------------------------------------------------------
if [[ ${REDIS_MODE} == native ]]; then
  log "installing and hardening Redis (${REDIS_PKGS[*]})"
  wait_for_dpkg_lock
  pkg_install "${REDIS_PKGS[@]}"
  # Debian puts it at /etc/redis/redis.conf; Amazon Linux's redis6 at /etc/redis6/redis6.conf.
  REDIS_CONF=""
  for candidate in /etc/redis/redis.conf /etc/redis6/redis6.conf /etc/redis.conf; do
    [[ -f ${candidate} ]] && { REDIS_CONF="${candidate}"; break; }
  done
  [[ -n ${REDIS_CONF} ]] || die "Redis installed but no redis.conf found."
  log "  config: ${REDIS_CONF}"
  sed -i -E \
    -e 's/^# *maxmemory-policy .*/maxmemory-policy noeviction/' \
    -e 's/^appendonly no/appendonly yes/' \
    -e 's/^bind .*/bind 127.0.0.1 -::1/' \
    "${REDIS_CONF}"
  grep -q '^maxmemory-policy' "${REDIS_CONF}" || echo 'maxmemory-policy noeviction' >> "${REDIS_CONF}"
  grep -q '^appendonly yes' "${REDIS_CONF}" || echo 'appendonly yes' >> "${REDIS_CONF}"
  systemctl enable --now "${REDIS_SVC}"
  systemctl restart "${REDIS_SVC}"
  # redis6 names its client redis6-cli; either is fine for a ping.
  "$(command -v redis-cli || command -v redis6-cli)" ping
else
  log "REDIS_MODE=${REDIS_MODE}: skipping Redis; REDIS_URL must point at a managed instance."
fi

# ---------------------------------------------------------------------------
# Service account and layout.
# ---------------------------------------------------------------------------
if id -u "${APP_USER}" >/dev/null 2>&1; then
  log "user ${APP_USER} already exists"
else
  log "creating service account ${APP_USER}"
  useradd --system --create-home --home-dir "${APP_HOME}" --shell /bin/bash "${APP_USER}"
fi
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0750 \
  "${APP_HOME}" "${APP_HOME}/logs" "${APP_HOME}/backups" "${APP_DIR}" "${PM2_HOME}"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0755 "$(dirname "${POSTGRES_CA_BUNDLE}")"

# ---------------------------------------------------------------------------
# The RDS CA bundle. POSTGRES_CA_CERT names a PEM FILE, not PEM content: without this the
# migrator fails with PostgresCaError before it opens a connection.
# ---------------------------------------------------------------------------
log "fetching the Amazon RDS CA bundle"
curl -fsSL -o "${POSTGRES_CA_BUNDLE}" https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
chown "${APP_USER}:${APP_USER}" "${POSTGRES_CA_BUNDLE}"
echo "  $(grep -c 'BEGIN CERTIFICATE' "${POSTGRES_CA_BUNDLE}") certificates -> ${POSTGRES_CA_BUNDLE}"

# ---------------------------------------------------------------------------
# deploy.conf and the .env.backend placeholder. Never overwritten.
# ---------------------------------------------------------------------------
if [[ -f ${APP_HOME}/deploy.conf ]]; then
  log "${APP_HOME}/deploy.conf exists; leaving it alone"
elif [[ -f ${SCRIPT_DIR}/deploy.conf.example ]]; then
  log "seeding ${APP_HOME}/deploy.conf — edit it before deploying"
  install -o "${APP_USER}" -g "${APP_USER}" -m 0640 "${SCRIPT_DIR}/deploy.conf.example" "${APP_HOME}/deploy.conf"
fi

ENV_FILE="${APP_HOME}/.env.backend"
if [[ -f ${ENV_FILE} ]]; then
  log "${ENV_FILE} exists; leaving it alone"
else
  log "creating an empty ${ENV_FILE} (0600) — fill it from apps/backend-api/.env.example"
  install -o "${APP_USER}" -g "${APP_USER}" -m 0600 /dev/null "${ENV_FILE}"
fi

# ---------------------------------------------------------------------------
# Reverse proxy.
# ---------------------------------------------------------------------------
if [[ ${WEB_SERVER} == apache ]]; then
  log "installing Apache (${HTTPD_PKGS[*]}) and the modules the API needs"
  wait_for_dpkg_lock
  pkg_install "${HTTPD_PKGS[@]}"
  if [[ ${PKG} == apt ]]; then
    # mpm_event and authz_core are not optional: without them `Require` is an unknown directive
    # and Apache will not even pass a config test.
    a2enmod proxy proxy_http proxy_wstunnel headers rewrite ssl mpm_event \
            access_compat alias auth_basic authn_core authn_file authz_core authz_host authz_user \
            autoindex deflate dir env filter mime negotiation reqtimeout setenvif status >/dev/null
    a2dissite 000-default >/dev/null 2>&1 || true
  else
    # No a2enmod on this family: httpd loads whatever conf.modules.d declares, and the base set
    # already covers everything the vhost needs except proxy_wstunnel, which Socket.IO does need.
    # Assert rather than assume — a missing LoadModule is a config error at reload, not here.
    for mod in proxy_module proxy_http_module proxy_wstunnel_module headers_module \
               rewrite_module ssl_module authz_core_module; do
      grep -rqs "^LoadModule ${mod}" /etc/httpd/conf.modules.d /etc/httpd/conf \
        || die "httpd is missing ${mod}; the vhost will not load."
    done
    # The stock welcome page answers / on every vhost and would shadow the proxy.
    [[ -f /etc/httpd/conf.d/welcome.conf ]] && : > /etc/httpd/conf.d/welcome.conf
    # mod_ssl ships an ssl.conf pointing at a self-signed pair this image does not generate, and
    # Apache will not start while it is missing — before certbot has ever run, and so before
    # there is any real certificate to replace it with. Generate the stub it expects.
    if [[ ! -s /etc/pki/tls/certs/localhost.crt ]]; then
      log "generating the stub certificate mod_ssl's shipped ssl.conf refers to"
      install -d -m 0755 /etc/pki/tls/certs
      install -d -m 0700 /etc/pki/tls/private
      openssl req -new -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout /etc/pki/tls/private/localhost.key \
        -out /etc/pki/tls/certs/localhost.crt \
        -subj "/CN=localhost" >/dev/null 2>&1
      chmod 600 /etc/pki/tls/private/localhost.key
      chmod 644 /etc/pki/tls/certs/localhost.crt
    fi
  fi
  sed -e "s|__API_DOMAIN__|${API_DOMAIN}|g" -e "s|__API_PORT__|${API_PORT}|g" \
      -e "s|__LOG_DIR__|${HTTPD_LOG_DIR}|g" \
    "${SCRIPT_DIR}/apache/komtru-api.conf.template" > "${HTTPD_SITE}"
  [[ ${PKG} == apt ]] && a2ensite komtru-api >/dev/null
  # `apachectl` exists on both; `apache2ctl` does not exist on Amazon Linux.
  apachectl configtest
  systemctl enable --now "${HTTPD_SVC}"
  systemctl reload "${HTTPD_SVC}"
else
  die "WEB_SERVER=${WEB_SERVER} is not supported by this script; only 'apache' is implemented."
fi

# ---------------------------------------------------------------------------
# TLS. certbot reuses the host's existing Let's Encrypt account when there is one; TLS_EMAIL only
# matters when registering a new account. The DNS record must already resolve here.
# ---------------------------------------------------------------------------
log "requesting a certificate for ${API_DOMAIN}"
CERTBOT_ARGS=(--apache --non-interactive --agree-tos --redirect -d "${API_DOMAIN}")
if [[ -n ${TLS_EMAIL} ]]; then CERTBOT_ARGS+=(-m "${TLS_EMAIL}"); else CERTBOT_ARGS+=(--register-unsafely-without-email); fi
certbot "${CERTBOT_ARGS[@]}" \
  || warn "certbot failed. The HTTP-01 challenge needs ${API_DOMAIN} to resolve here AND inbound
         tcp/80 open in this instance's security group. Fix both, then rerun:
           sudo certbot --apache -d ${API_DOMAIN}"

# ---------------------------------------------------------------------------
# Renewal. certbot prints "Certbot has set up a scheduled task to automatically renew" whether or
# not anything will actually run it: Amazon Linux ships certbot-renew.timer DISABLED and has no
# cron daemon at all, so without this the certificate quietly expires ninety days later. The
# deploy hook matters just as much — certbot writes the new certificate but does not restart the
# server still holding the old one in memory.
# ---------------------------------------------------------------------------
log "scheduling certificate renewal"
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-httpd.sh <<HOOK
#!/bin/sh
systemctl reload ${HTTPD_SVC}
HOOK
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/reload-httpd.sh
if systemctl list-unit-files 2>/dev/null | grep -q '^certbot-renew\.timer'; then
  systemctl enable --now certbot-renew.timer
  echo "  certbot-renew.timer: $(systemctl is-active certbot-renew.timer)"
elif systemctl list-unit-files 2>/dev/null | grep -q '^snap\.certbot'; then
  echo "  renewal handled by the certbot snap's own timer"
else
  warn "no certbot renewal timer found; add one or the certificate expires in 90 days."
fi

# ---------------------------------------------------------------------------
# PM2 under systemd. PM2_HOME is passed explicitly: pm2 derives it from $HOME, sudo does not
# reliably carry HOME, and the default lands the dump file in /tmp where a reboot erases it.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Swap. Out of the same root volume as everything else, so refuse to create it if that would
# leave the disk nearly full — running out of disk is the failure this host has already had.
# ---------------------------------------------------------------------------
if [[ ${SWAP_SIZE_MB} -gt 0 ]]; then
  if swapon --show 2>/dev/null | grep -q '^/swapfile'; then
    log "swapfile already active ($(swapon --show=SIZE --noheadings | head -1 | tr -d ' '))"
  else
    AVAIL_MB="$(df --output=avail -BM / | tail -1 | tr -dc '0-9')"
    if (( AVAIL_MB - SWAP_SIZE_MB < 1024 )); then
      warn "only ${AVAIL_MB}MB free; a ${SWAP_SIZE_MB}MB swapfile would leave under 1GB. Skipping — grow the volume first."
    else
      log "creating a ${SWAP_SIZE_MB}MB swapfile"
      # dd, not fallocate: a fallocated file can contain holes, and swapon refuses those on
      # some filesystems. Zeroing a gigabyte costs seconds and always works.
      dd if=/dev/zero of=/swapfile bs=1M count="${SWAP_SIZE_MB}" status=none
      chmod 600 /swapfile
      mkswap /swapfile >/dev/null
      swapon /swapfile
      grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
  fi
  # swappiness 10: with this much RAM the swapfile is an emergency buffer, not somewhere the
  # kernel should be moving warm pages on a disk this small.
  printf 'vm.swappiness=10\nvm.vfs_cache_pressure=50\n' > /etc/sysctl.d/99-komtru-swap.conf
  sysctl --quiet -p /etc/sysctl.d/99-komtru-swap.conf
fi

# ---------------------------------------------------------------------------
# Log rotation. PM2 does not rotate its own logs at all, and Ubuntu's rsyslog entry rotates on a
# schedule with no size ceiling — between them, this host once filled an 8 GB volume.
# ---------------------------------------------------------------------------
log "installing log rotation"
sed -e "s/maxsize 50M/maxsize ${LOGROTATE_MAX_SIZE}/" \
    -e "s|/srv/komtru/logs|${APP_HOME}/logs|g" \
    -e "s/su komtru komtru/su ${APP_USER} ${APP_USER}/" \
  "${SCRIPT_DIR}/logrotate/komtru" > /etc/logrotate.d/komtru
chmod 0644 /etc/logrotate.d/komtru
# A size ceiling on the DISTRIBUTION's rsyslog entry rather than a second config: logrotate
# refuses to run at all when a file is claimed by two definitions.
# Amazon Linux journals to systemd and ships no rsyslog entry, so this is Debian-only in practice.
if [[ -f /etc/logrotate.d/rsyslog ]] && ! grep -q maxsize /etc/logrotate.d/rsyslog; then
  sed -i "0,/^\s*rotate /s//\tmaxsize ${LOGROTATE_MAX_SIZE}\n\trotate /" /etc/logrotate.d/rsyslog
fi
# The journal has no ceiling by default and is what grows instead on a systemd-only image.
if [[ ! -f /etc/logrotate.d/rsyslog ]]; then
  install -d -m 0755 /etc/systemd/journald.conf.d
  printf '[Journal]\nSystemMaxUse=200M\n' > /etc/systemd/journald.conf.d/99-komtru.conf
  systemctl restart systemd-journald 2>/dev/null || true
fi
logrotate --debug /etc/logrotate.conf >/dev/null 2>&1 || warn "logrotate reports a configuration problem; run: logrotate --debug /etc/logrotate.conf"
systemctl enable --now logrotate.timer >/dev/null 2>&1 || true

log "registering PM2 with systemd for ${APP_USER}"
env PATH="${PATH}:$(dirname "$(command -v node)")" PM2_HOME="${PM2_HOME}" \
  pm2 startup systemd -u "${APP_USER}" --hp "${APP_HOME}" >/dev/null
systemctl enable "pm2-${APP_USER}" >/dev/null 2>&1 || true
# Enabled is not running. deploy.sh starts PM2 directly, which leaves a daemon systemd does not
# own: everything works until the first reboot, when systemd starts a second one from the dump
# and the ports collide. Starting the unit here means the state a reboot reproduces is the state
# the host is already in.
systemctl is-active --quiet "pm2-${APP_USER}" || systemctl start "pm2-${APP_USER}" 2>/dev/null || true

log "bootstrap complete"
cat <<DONE

Next:

  1. Edit ${APP_HOME}/.env.backend (0600). POSTGRES_CA_CERT must be ${POSTGRES_CA_BUNDLE}
     and REDIS_URL must be redis://127.0.0.1:6379 when REDIS_MODE=native.
  2. Get the code into ${APP_DIR} — scripts/deploy/push.sh from a workstation, or set
     APP_SOURCE=git and give the instance a read-only deploy key.
  3. sudo -u ${APP_USER} bash ${APP_DIR}/scripts/deploy/deploy.sh

DONE
