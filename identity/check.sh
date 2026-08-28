#!/usr/bin/env bash
# Neop identity gate — shared by git hooks and agents.
#
# Usage:
#   ./identity/check.sh           # commit-time checks
#   ./identity/check.sh --push    # also remote / gh / github-identity check
#   ./identity/check.sh --msg FILE  # scan a commit message file
#
# If .identity is absent: exit 0 (gates off) with a one-line hint.
# If .identity is present: any mismatch exits non-zero.
#
# Never print tokens or private key material — only expected vs got labels.
# Portable to macOS Bash 3.2+ (no associative arrays).

set -euo pipefail

MODE=commit
MSG_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push) MODE=push; shift ;;
    --msg)
      MSG_FILE="${2:-}"
      [[ -n "$MSG_FILE" ]] || { echo "identity: --msg requires a file path" >&2; exit 2; }
      shift 2
      ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "identity: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IDENTITY_FILE="${REPO_ROOT}/.identity"
ACTIVE_FILE="${HOME}/.github-profiles/active"

fail() {
  echo "identity: FAIL: $*" >&2
  exit 1
}

warn() {
  echo "identity: $*" >&2
}

cfg_get() {
  # cfg_get KEY DEFAULT  — reads KEY= from IDENTITY_FILE
  local key="$1"
  local default="${2:-}"
  local line val
  line="$(grep -E "^[[:space:]]*${key}=" "$IDENTITY_FILE" 2>/dev/null | tail -n1 || true)"
  if [[ -z "$line" ]]; then
    printf '%s' "$default"
    return 0
  fi
  val="${line#*=}"
  val="${val%%#*}"
  # trim
  val="$(printf '%s' "$val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  printf '%s' "$val"
}

# --- gates off ---
if [[ ! -f "$IDENTITY_FILE" ]]; then
  warn "privacy gates off (no .identity); copy .identity.example to enable"
  exit 0
fi

required_profile="$(cfg_get required_profile anon)"
required_git_name="$(cfg_get required_git_name)"
required_git_email="$(cfg_get required_git_email)"
required_gh_user="$(cfg_get required_gh_user)"
required_ssh_host="$(cfg_get required_ssh_host github.com-anon)"
required_remote_org="$(cfg_get required_remote_org theSeattleUnfreeze)"
forbidden_substrings="$(cfg_get forbidden_substrings)"
require_signing_matches_anon="$(cfg_get require_signing_matches_anon 1)"

[[ -n "$required_git_name" ]] || fail ".identity missing required_git_name"
[[ -n "$required_git_email" ]] || fail ".identity missing required_git_email"
[[ -n "$required_gh_user" ]] || fail ".identity missing required_gh_user"

contains_forbidden() {
  local haystack="$1"
  local lower part
  lower="$(printf '%s' "$haystack" | tr '[:upper:]' '[:lower:]')"
  local IFS=','
  for part in $forbidden_substrings; do
    part="$(printf '%s' "$part" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')"
    [[ -z "$part" ]] && continue
    case "$lower" in
      *"$part"*) return 0 ;;
    esac
  done
  return 1
}

# --- github-identity profile ---
if ! command -v github-identity >/dev/null 2>&1; then
  fail "github-identity not found in PATH (required when .identity is present)"
fi

if [[ ! -f "$ACTIVE_FILE" ]]; then
  fail "no github-identity profile active — run: github-identity ${required_profile}"
fi
active="$(tr -d '[:space:]' < "$ACTIVE_FILE")"
if [[ "$active" != "$required_profile" ]]; then
  fail "active profile is '${active}', expected '${required_profile}' — run: github-identity ${required_profile}"
fi

# --- effective git identity ---
git_name="$(git -C "$REPO_ROOT" config --get user.name || true)"
git_email="$(git -C "$REPO_ROOT" config --get user.email || true)"
[[ -n "$git_name" ]] || fail "git user.name is empty"
[[ -n "$git_email" ]] || fail "git user.email is empty"

if [[ "$git_name" != "$required_git_name" ]]; then
  fail "git user.name is '${git_name}', expected '${required_git_name}'"
fi
if [[ "$git_email" != "$required_git_email" ]]; then
  fail "git user.email is '${git_email}', expected '${required_git_email}'"
fi

author_name="${GIT_AUTHOR_NAME:-$git_name}"
author_email="${GIT_AUTHOR_EMAIL:-$git_email}"
committer_name="${GIT_COMMITTER_NAME:-$git_name}"
committer_email="${GIT_COMMITTER_EMAIL:-$git_email}"

for pair in \
  "author.name:${author_name}" \
  "author.email:${author_email}" \
  "committer.name:${committer_name}" \
  "committer.email:${committer_email}" \
  "user.name:${git_name}" \
  "user.email:${git_email}"; do
  label="${pair%%:*}"
  value="${pair#*:}"
  if contains_forbidden "$value"; then
    fail "${label} contains a forbidden substring (privacy)"
  fi
done

if [[ "$author_email" != "$required_git_email" ]]; then
  fail "GIT_AUTHOR_EMAIL / author is '${author_email}', expected '${required_git_email}'"
fi
if [[ "$committer_email" != "$required_git_email" ]]; then
  fail "GIT_COMMITTER_EMAIL / committer is '${committer_email}', expected '${required_git_email}'"
fi

# --- commit message scan ---
if [[ -n "$MSG_FILE" ]]; then
  [[ -f "$MSG_FILE" ]] || fail "commit message file not found: ${MSG_FILE}"
  if contains_forbidden "$(cat "$MSG_FILE")"; then
    fail "commit message contains a forbidden substring (privacy)"
  fi
fi

# --- signing ---
gpgsign="$(git -C "$REPO_ROOT" config --get commit.gpgsign || true)"
gpg_format="$(git -C "$REPO_ROOT" config --get gpg.format || true)"
signing_key="$(git -C "$REPO_ROOT" config --get user.signingkey || true)"

if [[ "${gpgsign}" == "true" || "${gpg_format}" == "ssh" ]]; then
  if [[ "$require_signing_matches_anon" == "1" ]]; then
    if [[ -z "$signing_key" ]]; then
      fail "commit signing is enabled but user.signingkey is empty — configure anon signing key"
    fi
    if contains_forbidden "$signing_key"; then
      fail "user.signingkey appears tied to a forbidden identity"
    fi
    case "$signing_key" in
      *personal*|*amcmillion*)
        fail "user.signingkey looks personal — use the anon SSH/GPG key"
        ;;
    esac
  fi
fi

# --- push-only checks ---
if [[ "$MODE" == "push" ]]; then
  if ! github-identity check; then
    fail "github-identity check failed — run: github-identity ${required_profile} && github-identity check"
  fi

  if ! command -v gh >/dev/null 2>&1; then
    fail "gh CLI not found (required for push checks)"
  fi

  gh_login="$(gh api user --jq .login 2>/dev/null || true)"
  if [[ -z "$gh_login" ]]; then
    fail "could not read gh active user — re-auth as ${required_gh_user}"
  fi
  if [[ "$gh_login" != "$required_gh_user" ]]; then
    fail "gh active user is '${gh_login}', expected '${required_gh_user}'"
  fi

  while IFS= read -r remote_url; do
    [[ -z "$remote_url" ]] && continue
    case "$remote_url" in
      *github.com*|"git@${required_ssh_host}:"*|*"${required_ssh_host}:"*)
        ;;
      *)
        continue
        ;;
    esac

    case "$remote_url" in
      *"${required_remote_org}"*)
        ;;
      *)
        fail "remote URL does not target org '${required_remote_org}': ${remote_url}"
        ;;
    esac

    case "$remote_url" in
      "git@${required_ssh_host}:"*)
        ;;
      git@github.com-personal:*|*"github.com-personal"*)
        fail "remote uses personal SSH host — use ${required_ssh_host}: ${remote_url}"
        ;;
      git@github.com:*)
        warn "remote uses github.com SSH (prefer ${required_ssh_host}): ${remote_url}"
        ;;
      https://github.com/*|http://github.com/*)
        warn "remote uses HTTPS (prefer git@${required_ssh_host}:...): ${remote_url}"
        ;;
    esac
  done < <(git -C "$REPO_ROOT" remote -v | awk '{print $2}' | sort -u)
fi

echo "identity: OK (${MODE}; profile=${active}; user=${required_gh_user})"
exit 0
