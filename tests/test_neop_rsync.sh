#!/usr/bin/env bash
# neop-rsync stops a StartOS package before copy and starts it again after, including on failure.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/neop-rsync"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin" "$TMP/dest"
LOG="$TMP/calls.log"
touch "$LOG"

cat >"$TMP/bin/ssh" <<'EOF'
#!/usr/bin/env bash
echo "ssh $*" >> "$NEOP_FAKE_LOG"
if [[ "$*" == *"fuser -s"* ]]; then
  exit 1
fi
exit 0
EOF
cat >"$TMP/bin/rsync" <<'EOF'
#!/usr/bin/env bash
echo "rsync $*" >> "$NEOP_FAKE_LOG"
if [[ "${NEOP_FAKE_RSYNC_RC:-0}" != "0" ]]; then
  exit "$NEOP_FAKE_RSYNC_RC"
fi
exit 0
EOF
chmod +x "$TMP/bin/ssh" "$TMP/bin/rsync"

export PATH="$TMP/bin:$PATH"
export NEOP_FAKE_LOG="$LOG"

"$SCRIPT" --ssh start9@SSH_HOST --startos-package fulcrum \
  --src /remote/fulcrum/data/main/ --dest "$TMP/dest"
grep -q "package stop fulcrum" "$LOG"
grep -q "package start fulcrum" "$LOG"
grep -q -- "--rsync-path=sudo rsync" "$LOG"
# stop happens before rsync, start happens after
awk '
  /package stop/ { stop=NR }
  /^rsync / { copy=NR }
  /package start/ { start=NR }
  END { exit !(stop && copy && start && stop < copy && copy < start) }
' "$LOG"

# Failure still restarts the source service.
: >"$LOG"
set +e
NEOP_FAKE_RSYNC_RC=12 "$SCRIPT" --ssh start9@SSH_HOST --startos-package fulcrum \
  --src /remote/fulcrum/data/main/ --dest "$TMP/dest"
rc=$?
set -e
[[ "$rc" -eq 12 ]]
grep -q "package start fulcrum" "$LOG"

# Dry-run must not stop or start.
: >"$LOG"
"$SCRIPT" --ssh start9@SSH_HOST --startos-package fulcrum --dry-run \
  --src /remote/fulcrum/data/main/ --dest "$TMP/dest"
if grep -q "package stop" "$LOG" || grep -q "package start" "$LOG"; then
  echo "dry-run stopped or started the package" >&2
  exit 1
fi

echo "ok"
