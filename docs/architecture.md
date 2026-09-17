# Architecture — wrapper-first

Neapolitan is a **wrapper** around pinned Bitcoin validation engines, not a consensus reimplementation.

## Engines (pinned, not forked as full archives)

| Flavor | Engine | Role |
|--------|--------|------|
| `legacy` | Stock Bitcoin Core (pinned tag/commit) | SHA-256d tip validation |
| `blake2b` | Bitcoin Knots Blake2b hardfork ([#359](https://github.com/bitcoinknots/bitcoin/pull/359); plus [#358](https://github.com/bitcoinknots/bitcoin/pull/358) RDTS, [#363](https://github.com/bitcoinknots/bitcoin/pull/363) HeaderV2, [#357](https://github.com/bitcoinknots/bitcoin/pull/357) sighash when ready) | Blake2b PoW, v2 headers (~164 bytes, bit 31), tip policy |
| `rdts_sha256` (optional) | Archive tip only | Stalled SHA-256 RDTS lineage — not a first-class spend path |

**Do not** reimplement in this repo: Blake2b `GetHash`, ASIC profiles, header v2 layout, consensus policy, GBT/Stratum miner extensions. Delegate PoW checks to the pinned Knots binary; use Knots golden vectors as the CI oracle when Blake2b CI lands.

## What `neopd` owns

- Shared pre-split SHA-256 block / Electrum archive (one copy of common history)
- Post–Blake2b-activation shard for v2-header blocks (cannot share classic `blk` layout)
- Dual live chainstates: `chainstate-legacy/`, `chainstate-blake2b/`
- Flavor-scoped RPC (`flavor=legacy|blake2b`) and broadcast isolation
- Replay-safe UTXO catalog and default-deny send policy
- Wallet UX glue (confidence receipts, ceremony / unique-input rules)
- Electrum: **Fulcrum** on the Core port; **Shulcrum** dialect on the Knots port (neop orchestrates; does not own the ports)

Ops bootstrap for the shared `blk`/`rev` archive (symlinks, cut-off, never
clobber real files) is a **one-shot script**, not `neopd`: see
[`scripts/archive-blocks.sh`](../scripts/archive-blocks.sh) and
[hosting.md](hosting.md). Adapted from
[FlyTheElephant1/archive-blocks.sh](https://github.com/FlyTheElephant1/archive-blocks.sh).

## Electrum

Knots marked light clients out of scope. Upstream Fulcrum rejected Blake2b headers ([cculianu/Fulcrum#327](https://github.com/cculianu/Fulcrum/issues/327)).

**Core:** [Fulcrum](https://github.com/cculianu/Fulcrum) only — do not recommend electrs. **Knots:** pin [privkeyio/Fulcrum v2.1.2-blake-3](https://github.com/privkeyio/Fulcrum/releases/tag/v2.1.2-blake-3) (variable headers, protocol ≤1.6); [Kilombino/Shulcrum](https://github.com/Kilombino/Shulcrum) remains the alternative for protocol 1.7 / `blockchain.pow_algorithms`. Design notes: [Kilombino/blake2b-light-clients](https://github.com/Kilombino/blake2b-light-clients).

Wallets: Sparrow → Core Fulcrum; Shrike → Knots Electrum (privkeyio Fulcrum or Shulcrum) ([wallets.md](wallets.md)). Ops: [electrum.md](electrum.md). Metal import: [deploy-metal.md](deploy-metal.md).

Do **not** fork Blake2b hashing into neop. Testnet4 Electrum ports: `15001` (Core/Fulcrum), `15011` (Knots Electrum).

## Replay ethos (product core)

Same network magic means wire isolation alone is not enough. Protection is layered and **default-deny**. Normative detail: **[replay.md](replay.md)**.

1. Catalog labels: `core_only` | `knots_only` | `both` (replay-exposed; RPC may still say `legacy_only` / `blake2b_only`)
2. Refuse spends still valid on the non-selected tip unless **unique-input (taint)**, an embedded **wedge**, or `allow_dual_effect: true`
3. **Primary lasting Core bind:** taint / unique-input (Core shipped no lasting replay protection). Prefer Knots-first unified spends, then Core twins
4. **Knots-bound wedge:** opt-in Knots sighash ([#357](https://github.com/bitcoinknots/bitcoin/pull/357)) when enforced
5. **Temporary Core garnish:** `OP_RETURN` scriptPubKey **> 83 bytes** while RDTS ≤83 holds (expires 2027-09-01) — never alone as permanent protection
6. One-time `protectwallet` ceremony to partition `both` UTXOs; unique-input thereafter
7. Broadcast only to the selected chain’s mempool
8. Confidence receipt: `{ chain, txid, other_chain_affected: false }` (RPC may still say `flavor` / `other_flavor_affected`)

Never silent dual-broadcast. Never claim PoW alone stops replays. Lightning channel migration: [lightning.md](lightning.md) (gist is SoT).

## Scoop (optional)

**Scoop** is a separate read-only Next.js catalog UI (`scoop/`) that watches Fulcrum and Shulcrum, labels Core / Knots / both presence, and surfaces likely Spills. It does not sign or replace wallet apps. See [docs/scoop.md](scoop.md).

## Out of scope for v1

- Profitable Blake2b mining / DATUM ops
- Lightning migration tooling (forkward / CLN adapters / mirror broadcast) — see [lightning.md](lightning.md); external gist is SoT for channel splits
- Treating stalled RDTS SHA-256 as a spend path
- testnet3 (use testnet4 only)
