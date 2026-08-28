#!/usr/bin/env bash
# Point this clone at committed hooks under .githooks/
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_PATH=".githooks"

cd "$REPO_ROOT"

if [[ ! -d "$HOOKS_PATH" ]]; then
  echo "missing ${HOOKS_PATH}/" >&2
  exit 1
fi

chmod +x identity/check.sh
chmod +x "${HOOKS_PATH}/pre-commit" "${HOOKS_PATH}/commit-msg" "${HOOKS_PATH}/pre-push" 2>/dev/null || true

git config core.hooksPath "$HOOKS_PATH"

echo "Installed core.hooksPath=${HOOKS_PATH}"
echo "Next:"
echo "  cp .identity.example .identity   # enable privacy gates"
echo "  github-identity anon && github-identity check"
echo "  ./identity/check.sh && ./identity/check.sh --push"
