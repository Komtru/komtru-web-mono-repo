#!/usr/bin/env bash
#
# Push the working tree to a backend host, for as long as the monorepo has no git remote.
#
#   scripts/deploy/push.sh ubuntu@staging-api.komtru.com ~/.ssh/komtru-ec2
#
# This is the stopgap, not the destination. Once Komtru/komtru-monorepo exists, set
# APP_SOURCE=git in the host's deploy.conf and retire this script: an rsync carries whatever is
# in the working tree, including changes nobody has reviewed, and leaves no record on the host
# of what was deployed.
#
# It deliberately excludes every .env: the host's secrets live in /srv/komtru/.env.backend and
# must never be overwritten by a workstation's local configuration.
set -euo pipefail

TARGET="${1:-}"
KEY="${2:-}"
APP_USER="${APP_USER:-komtru}"
APP_DIR="${APP_DIR:-/srv/komtru/app}"

if [[ -z ${TARGET} ]]; then
  echo "usage: $0 <user@host> [ssh-key-path]" >&2
  exit 64
fi

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SSH_CMD="ssh -o BatchMode=yes"
[[ -n ${KEY} ]] && SSH_CMD="${SSH_CMD} -i ${KEY}"

echo "==> pushing ${REPO_ROOT} to ${TARGET}:${APP_DIR}"
rsync -az --delete \
  -e "${SSH_CMD}" \
  --rsync-path="sudo rsync" \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='dist/' \
  --exclude='.turbo/' \
  --exclude='.vercel/' \
  --exclude='*.log' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.env.*.local' \
  --exclude='docs/specs/backend-apis.env' \
  "${REPO_ROOT}/" "${TARGET}:${APP_DIR}/"

# rsync ran as root through sudo, so everything it wrote is root-owned; the service account
# could not then install into node_modules.
# shellcheck disable=SC2086
${SSH_CMD} "${TARGET}" "sudo chown -R ${APP_USER}:${APP_USER} ${APP_DIR}"

echo "==> pushed. Now run:"
echo "    ${SSH_CMD} ${TARGET} 'sudo -u ${APP_USER} bash ${APP_DIR}/scripts/deploy/deploy.sh'"
