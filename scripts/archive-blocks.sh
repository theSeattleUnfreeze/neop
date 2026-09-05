#!/usr/bin/env bash
# archive-blocks.sh — shared pre-split blk/rev archive helper for Neapolitan (neop)
#
# Copyright (C) 2026 FlyTheElephant1
# Copyright (C) 2026 theSeattleUnfreeze (neop adaptations)
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 2 of the License, or
# (at your option) any later version.
#
# Attribution
# -----------
# Design and safety rules (idempotent symlinks, never overwrite a real
# file with a symlink, owner/mode checks, conservative mtime cut-off)
# come from FlyTheElephant1's archive-blocks.sh:
#   https://github.com/FlyTheElephant1/archive-blocks.sh
# Licensed under GPL-2.0. This file is a neop-oriented adaptation of that
# work (dual Core/Knots bootstrap framing, suggest-cutoff helper, Blake2b
# tip caveat). Prefer the upstream script for the original full-migrate
# (-r) workflow; neop keeps runtime mux / chainstate / Electrum in neopd.
#
# Scope
# -----
# One-shot filesystem ceremony for SHA-256d history only. Post–Blake2b
# activation tip files (v2 headers) must NOT live in the shared archive.
#
set -euo pipefail

MAX_FILE=""
IN_DIR=""
OUT_DIR=""
ADD_DIR=""
SUGGEST=false
DRY_RUN=false
MARGIN=3

usage() {
  cat <<'EOF'
Usage:
  Archive mode (move ≤ cut-off into shared archive; symlink back):
    archive-blocks.sh -i <blocks> -o <archive> -n <NNNNN>

  Bootstrap mode (new blocks/ of symlinks into archive; tip stays private):
    archive-blocks.sh -i <reference-blocks> -o <archive> -a <new-blocks> -n <NNNNN>

  Suggest a conservative cut-off from mtimes (does not move files):
    archive-blocks.sh -i <blocks> --suggest-cutoff [--margin N]

Options:
  -i DIR              Reference / source blocks directory (required)
  -o DIR              Shared archival directory for real low-frequency files
  -a DIR              New blocks directory (bootstrap mode)
  -n NNNNN            Highest blk/rev file number treated as common history
  --suggest-cutoff    Print a recommended -n from mtime ordering
  --margin N          Files earlier than the newest pre-split candidate (default: 3)
  --dry-run           Print actions without changing the filesystem
  -h, --help          Show this help

Choosing -n safely (from FlyTheElephant1):
  1. ls -lt blocks/blk*.dat | head -20
  2. Take the highest file whose mtime is clearly before the split, then go
     2–4 files earlier (--margin, default 3).
  3. Prefer slightly conservative. File numbers are NOT block heights.

Safety (from FlyTheElephant1; preserved here):
  • Idempotent — re-running leaves correct symlinks and existing files alone
  • Never replace a real file with a symlink
  • Refuse to continue if archive/new dir owner:group or mode disagree with -i
EOF
  exit 0
}

die() { echo "Error: $*" >&2; exit 1; }

# Portable owner:group and mode (GNU and BSD/macOS).
stat_owner() {
  local p=$1
  if stat -c '%u:%g' "$p" >/dev/null 2>&1; then
    stat -c '%u:%g' "$p"
  else
    stat -f '%u:%g' "$p"
  fi
}

stat_mode() {
  local p=$1
  if stat -c '%a' "$p" >/dev/null 2>&1; then
    stat -c '%a' "$p"
  else
    # BSD: permissions as octal without sticky bits noise
    stat -f '%OLp' "$p"
  fi
}

stat_size() {
  local p=$1
  if stat -c '%s' "$p" >/dev/null 2>&1; then
    stat -c '%s' "$p"
  else
    stat -f '%z' "$p"
  fi
}

stat_mtime_epoch() {
  local p=$1
  if stat -c '%Y' "$p" >/dev/null 2>&1; then
    stat -c '%Y' "$p"
  else
    stat -f '%m' "$p"
  fi
}

realpath_m() {
  # Prefer GNU realpath -m; fall back to python for macOS/BSD.
  if command -v realpath >/dev/null 2>&1 && realpath -m / >/dev/null 2>&1; then
    realpath -m "$1"
  else
    python3 -c 'import os,sys; print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$1"
  fi
}

human_bytes() {
  local n=$1
  if command -v numfmt >/dev/null 2>&1; then
    numfmt --to=iec-i --suffix=B "$n"
  else
    python3 -c 'import sys; n=int(sys.argv[1])
u=["B","KiB","MiB","GiB","TiB"]; i=0
while n>=1024 and i<len(u)-1: n/=1024; i+=1
print(f"{n:.1f}{u[i]}" if i else f"{n}{u[i]}")' "$n"
  fi
}

pad5() {
  printf '%05d' "$((10#$1))"
}

ensure_dir_and_perms() {
  local target=$1
  local label=$2

  if [[ ! -d "$target" ]]; then
    echo "Creating $label: $target"
    if ! $DRY_RUN; then
      mkdir -p "$target"
    else
      return 0
    fi
  fi

  local in_owner in_mode out_owner out_mode
  in_owner=$(stat_owner "$IN_DIR")
  in_mode=$(stat_mode "$IN_DIR")
  out_owner=$(stat_owner "$target")
  out_mode=$(stat_mode "$target")

  if [[ "$in_owner" != "$out_owner" || "$in_mode" != "$out_mode" ]]; then
    echo
    echo "Permission mismatch on $label."
    echo "  Reference (-i) : owner/group = $in_owner  mode = $in_mode"
    echo "  Target         : owner/group = $out_owner  mode = $out_mode"
    echo
    echo "Align permissions, then re-run. Example (Linux):"
    echo "  sudo chown --reference=\"$IN_DIR\" \"$target\""
    echo "  sudo chmod --reference=\"$IN_DIR\" \"$target\""
    echo
    exit 1
  fi
  echo "Permissions OK on $label."
}

# Never overwrite a real file with a symlink (FlyTheElephant1 rule).
ensure_symlink() {
  local src=$1 # real file in archive
  local dst=$2 # path that should become a symlink

  if [[ ! -f "$src" ]]; then
    return 0
  fi
  if [[ -L "$dst" ]]; then
    return 0
  fi
  if [[ -e "$dst" ]]; then
    echo "WARNING: $dst exists and is not a symlink — leaving it alone"
    return 0
  fi
  echo "  ln -s $src → $dst"
  if ! $DRY_RUN; then
    ln -s "$src" "$dst"
  fi
}

suggest_cutoff() {
  local blocks=$1
  local margin=$2
  shopt -s nullglob
  local files=("$blocks"/blk*.dat)
  shopt -u nullglob
  if [[ ${#files[@]} -eq 0 ]]; then
    die "no blk*.dat under $blocks"
  fi

  # Sort by mtime ascending (oldest first), then by name for stability.
  local sorted
  sorted=$(
    for f in "${files[@]}"; do
      [[ -L "$f" ]] && continue
      [[ -f "$f" ]] || continue
      base=$(basename "$f")
      [[ $base =~ ^blk([0-9]+)\.dat$ ]] || continue
      echo "$(stat_mtime_epoch "$f") ${BASH_REMATCH[1]} $base"
    done | sort -n -k1,1 -k2,2
  )

  if [[ -z "$sorted" ]]; then
    die "no real (non-symlink) blk*.dat files to suggest from"
  fi

  echo "Recent real blk*.dat by mtime (oldest → newest), last 15:"
  echo "$sorted" | tail -15 | while read -r epoch num base; do
    ts=$(date -r "$epoch" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -d "@$epoch" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "$epoch")
    printf '  %s  %s\n' "$ts" "$base"
  done
  echo
  echo "Pick the highest file clearly BEFORE the chain split, then subtract"
  echo "margin=$margin (FlyTheElephant1 recipe: go 2–4 files earlier)."
  echo
  echo "Candidates (newest real files first):"
  echo "$sorted" | tac 2>/dev/null || echo "$sorted" | tail -r 2>/dev/null || echo "$sorted" | awk '{a[NR]=$0} END{for(i=NR;i>=1;i--)print a[i]}'
  local newest_num
  newest_num=$(echo "$sorted" | awk 'END{print $2}')
  local suggested=$((10#$newest_num - margin))
  if (( suggested < 0 )); then suggested=0; fi
  printf '\nIf the newest real tip file is still pre-split, a conservative -n is %s\n' "$(pad5 "$suggested")"
  printf '(newest real file number %s minus margin %s).\n' "$(pad5 "$newest_num")" "$margin"
  printf 'If the tip already includes post-split files, choose -n from mtime\n'
  printf 'manually — do not use this automatic suggestion.\n'
}

# --- arg parse ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    -i) IN_DIR=$2; shift 2 ;;
    -o) OUT_DIR=$2; shift 2 ;;
    -a) ADD_DIR=$2; shift 2 ;;
    -n) MAX_FILE=$2; shift 2 ;;
    --suggest-cutoff) SUGGEST=true; shift ;;
    --margin) MARGIN=$2; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

[[ -n "$IN_DIR" ]] || die "-i is required"
IN_DIR=$(realpath_m "$IN_DIR")
[[ -d "$IN_DIR" ]] || die "reference/input directory does not exist: $IN_DIR"

if $SUGGEST; then
  suggest_cutoff "$IN_DIR" "$MARGIN"
  exit 0
fi

[[ -n "$OUT_DIR" && -n "$MAX_FILE" ]] || die "-o and -n are required (unless --suggest-cutoff)"
OUT_DIR=$(realpath_m "$OUT_DIR")
[[ -n "$ADD_DIR" ]] && ADD_DIR=$(realpath_m "$ADD_DIR")

# Normalize cut-off to zero-padded width matching bitcoin blk names when possible.
if [[ ! "$MAX_FILE" =~ ^[0-9]+$ ]]; then
  die "-n must be a non-negative integer (example: 05687)"
fi
MAX_FILE=$(pad5 "$MAX_FILE")
MAX_NUM=$((10#$MAX_FILE))

echo "NOTE: Shared archive is for SHA-256d history only."
echo "      Do not put post–Blake2b (v2-header) tip files in -o."
echo

# ------------------------------------------------------------------
# Bootstrap mode
# ------------------------------------------------------------------
if [[ -n "$ADD_DIR" ]]; then
  echo "=== Bootstrap mode (FlyTheElephant1-style shared archive) ==="
  echo "New blocks directory : $ADD_DIR"
  echo "Archive              : $OUT_DIR"
  echo "Reference            : $IN_DIR"
  echo "Cut-off              : $MAX_FILE"
  echo

  ensure_dir_and_perms "$ADD_DIR" "new blocks directory"
  ensure_dir_and_perms "$OUT_DIR" "archival directory"

  echo "Ensuring low-frequency symlinks (≤ $MAX_FILE) ..."
  local_i=0
  while (( local_i <= MAX_NUM )); do
    idx=$(pad5 "$local_i")
    for type in blk rev; do
      ensure_symlink "$OUT_DIR/${type}${idx}.dat" "$ADD_DIR/${type}${idx}.dat"
    done
    local_i=$((local_i + 1))
  done

  if [[ -f "$IN_DIR/xor.dat" && ! -e "$ADD_DIR/xor.dat" ]]; then
    echo "Copying xor.dat"
    if ! $DRY_RUN; then cp -a "$IN_DIR/xor.dat" "$ADD_DIR/xor.dat"; fi
  fi

  if [[ -d "$IN_DIR/index" && ! -d "$ADD_DIR/index" ]]; then
    echo "Copying index/ (only valid if tip files after $MAX_FILE match the reference)."
    echo "If this flavor will diverge, delete index/ before starting the node."
    if ! $DRY_RUN; then cp -a "$IN_DIR/index" "$ADD_DIR/index"; fi
  fi

  if [[ -e "$ADD_DIR/.lock" ]]; then
    echo "Removing stale .lock from new blocks directory"
    if ! $DRY_RUN; then rm -f "$ADD_DIR/.lock"; fi
  fi

  echo
  echo "Bootstrap complete."
  echo "chainstate/ and Electrum indexes are NOT handled here — neopd / engines own those."
  exit 0
fi

# ------------------------------------------------------------------
# Archive mode
# ------------------------------------------------------------------
echo "=== Archive mode ==="
echo "Cut-off: $MAX_FILE"
echo

ensure_dir_and_perms "$OUT_DIR" "archival directory"

NEEDED_BYTES=0
FILES_TO_MOVE=()

local_i=0
while (( local_i <= MAX_NUM )); do
  idx=$(pad5 "$local_i")
  for type in blk rev; do
    src="$IN_DIR/${type}${idx}.dat"
    dst="$OUT_DIR/${type}${idx}.dat"
    if [[ -f "$src" && ! -L "$src" && ! -f "$dst" ]]; then
      size=$(stat_size "$src")
      NEEDED_BYTES=$((NEEDED_BYTES + size))
      FILES_TO_MOVE+=("$src|$dst")
    fi
  done
  local_i=$((local_i + 1))
done

if [[ ${#FILES_TO_MOVE[@]} -eq 0 ]]; then
  echo "No files need to be moved (already archived or missing from source)."
else
  echo "Data still to archive: $(human_bytes "$NEEDED_BYTES")"
  for entry in "${FILES_TO_MOVE[@]}"; do
    IFS='|' read -r src dst <<<"$entry"
    echo "  mv $(basename "$src") → archive"
    if ! $DRY_RUN; then
      mv "$src" "$dst"
    fi
  done
fi

# Symlink originals back to archive (idempotent; never clobber real files).
local_i=0
while (( local_i <= MAX_NUM )); do
  idx=$(pad5 "$local_i")
  for type in blk rev; do
    src="$IN_DIR/${type}${idx}.dat"
    dst="$OUT_DIR/${type}${idx}.dat"
    if [[ -f "$dst" ]]; then
      if [[ -L "$src" ]]; then
        :
      elif [[ -f "$src" ]]; then
        echo "Replacing ${type}${idx}.dat with symlink (was a leftover real file after move)"
        if ! $DRY_RUN; then
          rm -f "$src"
          ln -s "$dst" "$src"
        fi
      elif [[ ! -e "$src" ]]; then
        echo "Creating symlink for ${type}${idx}.dat"
        if ! $DRY_RUN; then
          ln -s "$dst" "$src"
        fi
      fi
    fi
  done
  local_i=$((local_i + 1))
done

echo
echo "Done. Archived files up to ${MAX_FILE}.dat are shared via symlinks."
echo "Files after ${MAX_FILE}.dat remain private to this node / flavor."
