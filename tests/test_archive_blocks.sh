#!/usr/bin/env bash
# Smoke test for scripts/archive-blocks.sh safety rules.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/archive-blocks.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/ref" "$TMP/archive" "$TMP/boot" "$TMP/ref/index"
# Match owner/mode by creating under same user; chmod both sides equal.
chmod 755 "$TMP/ref" "$TMP/archive" "$TMP/boot"

# Three small fake blk/rev pairs
for n in 00000 00001 00002; do
  echo "blk$n" >"$TMP/ref/blk${n}.dat"
  echo "rev$n" >"$TMP/ref/rev${n}.dat"
done
echo "poison" >"$TMP/ref/index/dummy"
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
# Dual-flavor bootstrap must not copy the reference blocks/index
[[ ! -e "$TMP/boot/index" ]]

# Idempotent re-run
"$SCRIPT" -i "$TMP/ref" -o "$TMP/archive" -a "$TMP/boot" -n 00001
[[ "$(cat "$TMP/boot/blk00001.dat")" == "KEEP_ME" ]]
[[ ! -e "$TMP/boot/index" ]]

# Fresh mkdir inherits reference mode (avoid umask footgun)
mkdir -p "$TMP/ref750"
chmod 750 "$TMP/ref750"
echo "x" >"$TMP/ref750/blk00000.dat"
echo "y" >"$TMP/ref750/rev00000.dat"
"$SCRIPT" -i "$TMP/ref750" -o "$TMP/arch750" -n 00000
[[ "$(stat -f '%OLp' "$TMP/arch750" 2>/dev/null || stat -c '%a' "$TMP/arch750")" == "750" ]]

echo "ok: archive-blocks safety smoke passed"
