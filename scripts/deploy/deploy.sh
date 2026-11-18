#!/usr/bin/env bash
#
# Release the Komtru backend on an instance already prepared by bootstrap-ec2.sh.
#
#   sudo -u komtru bash /srv/komtru/app/scripts/deploy/deploy.sh
#   sudo -u komtru REPO_REF=v1.2.0 bash .../deploy.sh      # only when APP_SOURCE=git
#
# Run it as the service account, never as root: a root-owned file in node_modules breaks the
# next deploy.
#
# Order, and why:
#   fetch -> install -> build -> migrate -> reload -> health check
#
# Build before migrate: a release that cannot compile must not change the schema.
# Migrate before reload: the new code may need the new columns, and the old code tolerates them,
# because tools/migration-safety enforces expand/contract on every pull request.
# Health check after reload: `pm2 reload` returning 0 proves only that PM2 forked something.
set -euo pipefail

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ ${EUID} -ne 0 ]] || die "do not run this as root. Use: sudo -u komtru bash $0"

APP_HOME="${APP_HOME:-/srv/komtru}"
CONF_FILE="${CONF_FILE:-${APP_HOME}/deploy.conf}"
[[ -f ${CONF_FILE} ]] || die "missing ${CONF_FILE}. Run bootstrap-ec2.sh first, then edit it."
set -a
# shellcheck source=/dev/null
. "${CONF_FILE}"
set +a

APP_HOME="${APP_HOME:-/srv/komtru}"
APP_DIR="${APP_DIR:-${APP_HOME}/app}"
APP_SOURCE="${APP_SOURCE:-rsync}"
REPO_URL="${REPO_URL:-}"
REPO_REF="${REPO_REF:-main}"
API_PORT="${API_PORT:-7813}"
ENV_FILE="${APP_HOME}/.env.backend"
# Only the backend and what it depends on. The Next.js apps deploy to Vercel and have no
# business being built here — on a small volume they are also the difference between fitting
# and filling the disk.
PNPM_FILTER="${PNPM_FILTER:-@komtru/backend-api...}"

# PM2 derives its home from $HOME, and `sudo -u` does not reliably carry HOME. Unset, the dump
# file lands in /tmp and `pm2 resurrect` finds nothing after a reboot.
export PM2_HOME="${PM2_HOME:-${APP_HOME}/.pm2}"
export HOME="${APP_HOME}"
export KOMTRU_APP_HOME="${APP_HOME}"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

[[ -f ${ENV_FILE} ]] || die "missing ${ENV_FILE}. The processes will not boot without it."
PERMS="$(stat -c '%a' "${ENV_FILE}" 2>/dev/null || stat -f '%Lp' "${ENV_FILE}")"
[[ ${PERMS} == 600 ]] || warn "${ENV_FILE} is mode ${PERMS}; it should be 600."

# Every subsequent command runs from here. Not cosmetic: PM2 spawns its daemon with the current
# working directory inherited, and if that is a directory the service account cannot read — for
# instance /home/ubuntu, which is 0750 — the daemon dies with `spawn /usr/bin/node EACCES`.
cd "${APP_DIR}" || die "cannot enter ${APP_DIR}"

PREVIOUS_SHA="$(git -C "${APP_DIR}" rev-parse HEAD 2>/dev/null || echo 'unknown')"

# ---------------------------------------------------------------------------
# 1. Source.
# ---------------------------------------------------------------------------
if [[ ${APP_SOURCE} == git ]]; then
  [[ -n ${REPO_URL} ]] || die "APP_SOURCE=git but REPO_URL is empty in ${CONF_FILE}."
  if [[ -d ${APP_DIR}/.git ]] && git -C "${APP_DIR}" remote get-url origin >/dev/null 2>&1; then
    log "fetching ${REPO_REF}"
    git -C "${APP_DIR}" remote set-url origin "${REPO_URL}"
    git -C "${APP_DIR}" fetch --prune --tags origin
  else
    die "${APP_DIR} is not a clone of ${REPO_URL}. Clone it first, or use APP_SOURCE=rsync."
  fi
  TARGET_SHA="$(git -C "${APP_DIR}" rev-parse --verify "origin/${REPO_REF}^{commit}" 2>/dev/null \
    || git -C "${APP_DIR}" rev-parse --verify "${REPO_REF}^{commit}")"
  log "deploying ${REPO_REF} = ${TARGET_SHA:0:12} (was ${PREVIOUS_SHA:0:12})"
  git -C "${APP_DIR}" checkout --force --detach "${TARGET_SHA}"
  # Stale build output, but never node_modules: re-fetching the store every deploy costs
  # minutes and buys nothing.
  git -C "${APP_DIR}" clean -fdx --exclude=node_modules --exclude='**/node_modules'
else
  log "APP_SOURCE=${APP_SOURCE}: building the tree already in ${APP_DIR} (HEAD ${PREVIOUS_SHA:0:12})"
fi

# ---------------------------------------------------------------------------
# 2. Dependencies. A full install, not --prod: db:migrate runs through tsx, a devDependency.
# ---------------------------------------------------------------------------
log "installing dependencies (${PNPM_FILTER})"
corepack enable >/dev/null 2>&1 || true
# confirmModulesPurge=false: when pnpm decides node_modules has to be rebuilt it asks first, and
# over ssh there is no TTY to answer with — the install dies with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
# instead of just doing the work. Targeted rather than CI=true, which would flip other defaults.
pnpm install --frozen-lockfile --config.confirmModulesPurge=false --filter "${PNPM_FILTER}"

# ---------------------------------------------------------------------------
# 3. Build, through turbo: the backend imports workspace packages by their `main`
#    (./dist/index.js), so a bare tsc compiles against output that does not exist yet.
# ---------------------------------------------------------------------------
log "building @komtru/backend-api"
pnpm exec turbo run build --filter=@komtru/backend-api
[[ -f apps/backend-api/dist/index.js ]]  || die "build produced no dist/index.js"
[[ -f apps/backend-api/dist/worker.js ]] || die "build produced no dist/worker.js"

# ---------------------------------------------------------------------------
# 4. Migrations, as the owner role through POSTGRES_DIRECT_URL. migrate-cli also reconciles the
#    seed data (the RBAC catalogue, the reserved namespace) from code, so it runs every deploy.
#
#    `--import tsx` rather than the tsx shim: no .bin path to resolve wrongly. --env-file points
#    at the deployment's secrets rather than the repository's absent .env.
# ---------------------------------------------------------------------------
log "running migrations and seeds"
( cd apps/backend-api && node --env-file="${ENV_FILE}" --import tsx src/db/migrate-cli.ts ) \
  || die "migrations failed. Nothing was reloaded; the previous release is still serving."

# ---------------------------------------------------------------------------
# 5. Reload. startOrReload starts the pair the first time and reloads it afterwards, one process
#    at a time, so the API keeps answering through a deploy.
# ---------------------------------------------------------------------------
log "reloading PM2 processes"
pm2 startOrReload apps/backend-api/ecosystem.config.cjs --update-env
pm2 save >/dev/null

# ---------------------------------------------------------------------------
# 6. Prove it came back.
# ---------------------------------------------------------------------------
log "waiting for /health/ready on 127.0.0.1:${API_PORT}"
READY=""
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${API_PORT}/health/ready" >/dev/null 2>&1; then
    READY=yes; break
  fi
  sleep 2
done

if [[ -z ${READY} ]]; then
  warn "the API never became ready. Last 50 log lines:"
  pm2 logs komtru-api --lines 50 --nostream || true
  die "deploy failed its health check."
fi

curl -sS "http://127.0.0.1:${API_PORT}/health/ready"; echo
pm2 list
log "deployed — API ready, worker running"
[[ ${APP_SOURCE} == git ]] && echo "Roll back with:  REPO_REF=${PREVIOUS_SHA} bash $0"
exit 0
