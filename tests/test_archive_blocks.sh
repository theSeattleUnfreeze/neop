#!/usr/bin/env bash
# Smoke test for scripts/archive-blocks.sh safety rules.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/archive-blocks.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/ref" "$TMP/archive" "$TMP/boot"
# Match owner/mode by creating under same user; chmod both sides equal.
chmod 755 "$TMP/ref" "$TMP/archive" "$TMP/boot"

# Three small fake blk/rev pairs
for n in 00000 00001 00002; do
  echo "blk$n" >"$TMP/ref/blk${n}.dat"
  echo "rev$n" >"$TMP/ref/rev${n}.dat"
done
# A real tip file that must never become a symlink target overwrite victim
echo "KEEP_ME" >"$TMP/boot/blk00001.dat"

"$SCRIPT" -i "$TMP/ref" -o "$TMP/archive" -n 00001
# Archived 00000 and 00001; tip 00002 stays in ref as a real file
[[ -f "$TMP/archive/blk00000.dat" && -L "$TMP/ref/blk00000.dat" ]]
[[ -f "$TMP/archive/blk00001.dat" && -L "$TMP/ref/blk00001.dat" ]]
[[ -f "$TMP/ref/blk00002.dat" && ! -L "$TMP/ref/blk00002.dat" ]]

"$SCRIPT" -i "$TMP/ref" -o "$TMP/archive" -a "$TMP/boot" -n 00001
# Symlink for 00000; 00001 left alone because a real file already exists
[[ -L "$TMP/boot/blk00000.dat" ]]
[[ -f "$TMP/boot/blk00001.dat" && ! -L "$TMP/boot/blk00001.dat" ]]
[[ "$(cat "$TMP/boot/blk00001.dat")" == "KEEP_ME" ]]

# Idempotent re-run
"$SCRIPT" -i "$TMP/ref" -o "$TMP/archive" -a "$TMP/boot" -n 00001
[[ "$(cat "$TMP/boot/blk00001.dat")" == "KEEP_ME" ]]

echo "ok: archive-blocks safety smoke passed"
