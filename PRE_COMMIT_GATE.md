# PRE_COMMIT_GATE.md

Qualitative checks and ordered commands before every commit or push in **neop**.

When `.identity` is present (maintainers / agents), git hooks enforce anonymity.
Do **not** use `--no-verify` or `--no-gpg-sign` to bypass them. See [AGENTS.md](AGENTS.md).

## Qualitative rules

- **Anon only** — commits, pushes, and `gh` writes use `theSeattleUnfreeze` / `github.com-anon`. No personal name, email, or primary GitHub account in git metadata, PR text, or agent fingerprints.
- **No secrets** — never commit `.env`, RPC passwords, cookies, SSH keys, or node credentials.
- **Placeholders in docs** — `STARTOS_HOST`, `VPS_PUBLIC_IP`, `USB_DATADIR`; not real infrastructure names.
- **Wrapper-first** — do not reimplement Blake2b PoW, v2 header crypto, consensus policy, or GBT/Stratum in this repo.
- **Replay ethos** — no silent dual-broadcast; default-deny `both` / replay-exposed spends unless explicitly allowed.
- **Naming** — **Core** and **Knots** chains only (no “Corecoin” / chain-specific “Bitcoin” token labels).
- **Shared archive script** — `scripts/archive-blocks.sh` is GPL-2.0 (derived from FlyTheElephant1); keep attribution; never put post–Blake2b tip files in the shared archive.
- **Scope** — minimize per PR; do not mix anonymity tooling with feature work unless necessary.

## Commit gate

Run from the repository root **in order**. All must pass (in addition to hooks when `.identity` is present).

### 1. Identity (maintainers / agents)

```bash
github-identity anon
github-identity check
./identity/check.sh
```

If you will push or open a PR:

```bash
./identity/check.sh --push
gh auth status   # active account: theSeattleUnfreeze
```

### 2. Unit tests (`neopd` + Python tests)

```bash
python -m unittest discover -s tests -v
```

### 3. Shared-archive smoke (when touching `scripts/archive-blocks.sh`)

```bash
./tests/test_archive_blocks.sh
```

### 4. Store smoke (when touching `neopd` store / datadir layout)

```bash
python -m neopd --ensure-store --datadir /tmp/neop-gate --network testnet4
```

### 5. Scoop (when touching `scoop/`)

```bash
cd scoop && npm test
```

Optional before a Scoop UI PR: `npm run build` (from `scoop/`).

## Pre-PR / Real Steel push

Before **`gh pr create`**, marking a PR ready, merging to **`main`**, or a Real Steel **push** after a pass:

1. Re-run the **Commit gate** on current `HEAD`.
2. Confirm `git log -1 --format='%an <%ae>'` is theSeattleUnfreeze noreply.
3. Confirm PR body uses the anon Cursor conversation id only (see AGENTS.md).
4. Prefer CI green when Actions are available (`.github/workflows/ci.yml`).

Draft WIP pushes may skip Scoop build / full CI wait, but **must not** skip identity hooks or invent personal attribution.
