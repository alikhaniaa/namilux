#!/usr/bin/env bash
# One command from the dev machine: ship the committed tree (git archive HEAD) to the server and run
# the whole release flow there (fetch → install → build → migrate → stage → activate). Nothing
# uncommitted ever reaches the server; the release name is the date + short SHA.
#
#   infra/server/deploy-from-local.sh root@203.0.113.10 ["-i KEYS/key.pem"] [release-name]
#   SSH_OPTS='-p 2222' infra/server/deploy-from-local.sh deploy@namilux.ir
set -euo pipefail
target=${1:?usage: deploy-from-local.sh user@host [ssh-identity-args] [release-name]}
ident=${2:-}
name=${3:-$(date +%Y%m%d-%H%M)-$(git rev-parse --short HEAD)}
[[ -z "$(git status --porcelain)" ]] || echo "note: working tree has uncommitted changes — only HEAD is shipped"
echo "→ release $name to $target"
# shellcheck disable=SC2086
git archive --format=tar HEAD | gzip -6 | ssh ${SSH_OPTS:-} $ident "$target" "sudo /opt/namilux/bin/release.sh '$name' all"
echo "✓ $name is live (rollback: ssh $target sudo /opt/namilux/bin/release.sh '$name' rollback)"
