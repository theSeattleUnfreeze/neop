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
- Live tips: **legacy** (Core) and **blake2b** (Knots Blake2b / BIP-110 lineage)
- Optional dead tip: `rdts_sha256` (archive only)
- Replay-safe spends: only the selected flavor is affected
- Daemon name: **`neopd`**

Validate on **Bitcoin Testnet4** before mainnet ([mempool.guide/testnet4](https://mempool.guide/testnet4)).

### Wrapper-first architecture (do not rebuild the wheel)

Core and Knots are **validation engines**. Pin versions; **do not reimplement** Blake2b PoW, v2 header crypto, consensus policy, or GBT/Stratum in this repo.

| Layer | Owns | Does **not** own |
|-------|------|------------------|
| Bitcoin Core (pinned) | Legacy SHA-256 validation / tip | Wallet UX, dual-flavor mux |
| Bitcoin Knots Blake2b (pinned; [#359](https://github.com/bitcoinknots/bitcoin/pull/359) lineage, plus #358 / #363 / #357 when ready) | Blake2b PoW, v2 headers, tip policy | Shared archive layout, replay UX |
| **`neopd`** | Shared pre-split SHA-256 archive mux, dual chainstates, flavor-scoped RPC, replay-safe catalog/send, wallet UX glue | Consensus crypto, mining/DATUM |
| Electrum | Vendor/run [Kilombino/Shulcrum](https://github.com/Kilombino/Shulcrum) (variable headers + `blockchain.pow_algorithms` / protocol 1.7) | Forking Blake2b hashing into neop |

**Ethos:** the user picks a flavor; **only that chain is affected** by a spend. Default-deny replay-exposed (`both`) UTXOs; ceremony / unique inputs; confidence receipts (`other_flavor_affected: false`). Never silent dual-broadcast. PoW alone is **not** replay protection (same network magic).

See [docs/architecture.md](docs/architecture.md), [docs/rpc.md](docs/rpc.md), [docs/testnet4.md](docs/testnet4.md), [docs/hosting.md](docs/hosting.md).

### Conventions

- Prefer placeholders in examples: `STARTOS_HOST`, `VPS_PUBLIC_IP`, not real infrastructure names.
- Never commit `.env`, RPC passwords, or node credentials.
- Minimize scope per PR; do not mix anonymity tooling changes with feature work unless necessary.
- Mining/DATUM = community test stack (paulscode et al.), not neop scope.
- Related but separate: `bip110-dashboard` monitoring UI — do not mix feature work unless asked.
