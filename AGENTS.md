# AGENTS.md — neop (Neapolitan)

Guidance for humans and coding agents working in this repository.

## Anonymity and privacy (read first)

This project is published under the **theSeattleUnfreeze** GitHub account only.
**Do not link this work to a maintainer's personal life, employer, or primary GitHub account.**

### Why this matters

- Public association with BIP-110 / Blake2b tooling can attract harassment or unwanted attention.
- A single leaked commit email, PR author, or SSH key on the wrong account breaks pseudonymity permanently.
- Personal identity must not appear in commits, PRs, issues, or agent-generated artifacts.

### Required workflow (before any git / gh write)

0. Install the identity CLI if missing ([theSeattleUnfreeze/github-identity](https://github.com/theSeattleUnfreeze/github-identity)):

```bash
git clone git@github.com-anon:theSeattleUnfreeze/github-identity.git
cd github-identity && ./install.sh
# edit ~/.github-profiles/anon.env if prompted, then:
github-identity anon && github-identity check
```

1. Switch and verify the anon profile:

```bash
github-identity anon
github-identity check
```

2. Enable repo privacy gates (maintainers / agents):

```bash
cp .identity.example .identity   # once per clone; .identity is gitignored
./identity/install-hooks.sh
./identity/check.sh
./identity/check.sh --push
```

3. If `.identity` is present, hooks **block** commit and push unless:
   - active `github-identity` profile is `anon`
   - `git` `user.name` / `user.email` match theSeattleUnfreeze noreply
   - commit author/committer and message contain no forbidden substrings
   - push remotes target `theSeattleUnfreeze` via `github.com-anon` (preferred)
   - `gh` active user is `theSeattleUnfreeze`
   - `github-identity check` passes
   - when commit signing is enabled, the signing key matches the anon identity

4. **Never** use `--no-verify` / `--no-gpg-sign` to bypass these gates.

5. **GitHub CLI**: confirm `gh auth status` shows **theSeattleUnfreeze** before `gh pr create` or other API writes.

6. **SSH remotes** use the anon host alias:

```bash
git@github.com-anon:theSeattleUnfreeze/neop.git
```

7. **Cursor agent fingerprint** on PRs: use the anon conversation id only; never embed personal account links.

### If something looks wrong

Stop. Run `github-identity check` and `./identity/check.sh --push`. Do not push until both pass. Review `git log -1 --format='%an <%ae>'` before every push.

---

## Project overview

**Neapolitan (`neop`)** is a dual-flavor Bitcoin node and coin-control wallet:

- Shared pre-split SHA-256 block / Electrum archive
- Live tips: **Core** chain (SHA-256d) and **Knots** chain (Blake2b-sia)
- Optional dead tip: `rdts_sha256` (archive only)
- Replay-safe spends: only the selected chain is affected
- Daemon name: **`neopd`**

Validate on **Bitcoin Testnet4** before mainnet ([mempool.guide/testnet4](https://mempool.guide/testnet4)).

### Naming (agents: use consistently)

**Chains:** **Core** and **Knots** only. Do not use separate coin names (no “Corecoin”, no chain-specific “Bitcoin” token labels).

**UTXOs:** say **UTXOs on the Core chain** or **UTXOs on the Knots chain** (catalog: `core_only` / `knots_only` / `both` when wired — today’s RPC may still say `legacy_only` / `blake2b_only`).

| Chain | PoW | Preferred node | RPC alias (today) |
|-------|-----|----------------|-------------------|
| **Knots** | Blake2b-sia | Knots (Blake2b [#359](https://github.com/bitcoinknots/bitcoin/pull/359)) | `blake2b` |
| **Core** | SHA-256d | Pre-RDTS Knots | `legacy` |

Distinguish **Core chain** (the SHA-256d tip) from the **Bitcoin Core node** (fallback validation software for the Core chain). Preferred engine for the Core chain is **pre-RDTS Knots**, not the Bitcoin Core node, unless Knots is unavailable.

### Validation engines (wrapper-first — do not rebuild the wheel)

Pin engine versions; **do not reimplement** Blake2b PoW, v2 header crypto, consensus policy, or GBT/Stratum in this repo.

| Node software | Chain | Policy |
|---------------|-------|--------|
| **Knots** (Blake2b hardfork) | **Knots** | Required. Knots upstream focus moves here. |
| **Pre-RDTS Knots** | **Core** | **Preferred** for SHA-256d validation. |
| **Bitcoin Core** | **Core** | Fallback only — works in a pinch, not recommended for new deployments. |
| **Bitcoin Core v29** | **Core** | Recommended if Knots drops SHA-256d support. |
| **Bitcoin Core v30** | **Core** | Not recommended with default settings; acceptable only with documented config changes (pin + document in compose when wired). |

| Layer | Owns | Does **not** own |
|-------|------|------------------|
| Knots node (Knots chain) / pre-RDTS Knots or Bitcoin Core node (Core chain) | Tip validation for the selected chain | Wallet UX, dual-flavor mux |
| **`neopd`** | Shared pre-split SHA-256 archive mux, dual chainstates, flavor-scoped RPC, replay-safe catalog/send, wallet UX glue | Consensus crypto, mining/DATUM |
| Electrum | Vendor/run [Kilombino/Shulcrum](https://github.com/Kilombino/Shulcrum) for **Knots chain**; **Fulcrum only** (not electrs) for **Core chain** | Forking Blake2b hashing into neop |

**Ethos:** the user picks a chain; **only that chain is affected** by a spend. Default-deny replay-exposed UTXOs present on **both** chains; ceremony / unique inputs / wedges; confidence receipts (`other_flavor_affected: false`). Never silent dual-broadcast. PoW alone is **not** replay protection (same network magic).

**Replay (agents):** Core-bound wedge = `OP_RETURN` scriptPubKey **> 83 bytes**; Knots-bound wedge = opt-in sighash ([#357](https://github.com/bitcoinknots/bitcoin/pull/357)) when enforced; one-time `protectwallet` partitions `both` coins. Normative: [docs/replay.md](docs/replay.md).

**Wallets (agents):** Core = Sparrow + Fulcrum; Knots = Shrike + Shulcrum — no stock-Sparrow profile switcher. See [docs/wallets.md](docs/wallets.md), [docs/deploy-metal.md](docs/deploy-metal.md), [docs/electrum.md](docs/electrum.md).

See [docs/architecture.md](docs/architecture.md), [docs/rpc.md](docs/rpc.md), [docs/replay.md](docs/replay.md), [docs/deploy-metal.md](docs/deploy-metal.md), [docs/wallets.md](docs/wallets.md), [docs/electrum.md](docs/electrum.md), [docs/testnet4.md](docs/testnet4.md), [docs/hosting.md](docs/hosting.md).

### Conventions

- **Git hygiene:** prefer a **topic branch on the primary clone**; do not open worktrees for ordinary feature work. Real Steel may use a dedicated worktree only when its overlay/skill requires it. See [`.cursor/rules/agent-git-hygiene.mdc`](.cursor/rules/agent-git-hygiene.mdc).
- Prefer placeholders in examples: `STARTOS_HOST`, `VPS_PUBLIC_IP`, not real infrastructure names.
- Never commit `.env`, RPC passwords, or node credentials.
- Minimize scope per PR; do not mix anonymity tooling changes with feature work unless necessary.
- Mining/DATUM = community test stack (paulscode et al.), not neop scope.
- Related but separate: `bip110-dashboard` monitoring UI — do not mix feature work unless asked.

## Real Steel review focus

Apply on every Real Steel pass for this repo. Prefer fund / privacy / replay safety over feature velocity. Run gates in [`PRE_COMMIT_GATE.md`](PRE_COMMIT_GATE.md) before any push from a pass.

**Disposition (required before merge):** every Critical / Suggestion / Nit is **Blocking** (fix in the PR), **Deferred** (open a GitHub issue and link it from the PR), or **Won't do** (one-line rationale on the PR). Never leave deferred findings as PR-only comments or untracked TODOs. See [`.cursor/rules/real-steel-disposition.mdc`](.cursor/rules/real-steel-disposition.mdc).

- **Anonymity** — author/committer, remotes, `gh` user, PR fingerprint, and commit messages must not leak a personal identity; `.identity` hooks must remain enforceable (no `--no-verify`)
- **Wrapper-first** — PRs must not reimplement Blake2b PoW, v2 header hashing, consensus policy, or mining/DATUM; engines stay pinned upstream
- **Replay safety** — catalog / send paths default-deny dual-effect (`both`) UTXOs; no silent dual-broadcast; confidence receipts stay honest (`other_flavor_affected`)
- **Chain naming** — user-facing and docs say **Core** / **Knots** (RPC may still say `legacy` / `blake2b`); reject “Corecoin”-style coin names
- **Shared pre-split archive** — `scripts/archive-blocks.sh` keeps FlyTheElephant1 safety rules (idempotent symlinks, never clobber a real file, permission checks, conservative cut-off); Blake2b tip files stay out of the shared archive; bootstrap must not force a second pre-fork IBD or reindex an already-supported flavor’s chainstate
- **Secrets & placeholders** — no `.env` / RPC creds in the tree; docs use `STARTOS_HOST` / `VPS_PUBLIC_IP`-style placeholders
- **Electrum split** — Fulcrum for Core, Shulcrum for Knots; do not fork Blake2b hashing into `neopd`
- **Scoop threat model** — bind defaults stay loopback; no private keys; xpubs/descriptors treated as sensitive
- **Testnet4 before mainnet** — consensus / wallet behavior validated on testnet4 (or regtest Blake2b) before mainnet claims
- **Scope hygiene** — one concern per PR; anonymity tooling not mixed into feature PRs unless required

See [docs/architecture.md](docs/architecture.md), [docs/rpc.md](docs/rpc.md), [docs/hosting.md](docs/hosting.md).

