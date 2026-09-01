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
- Electrum: speak the **Shulcrum** dialect on the blake2b port; classic Fulcrum/electrs assumptions on legacy

Ops bootstrap for the shared `blk`/`rev` archive (symlinks, cut-off, never
clobber real files) is a **one-shot script**, not `neopd`: see
[`scripts/archive-blocks.sh`](../scripts/archive-blocks.sh) and
[hosting.md](hosting.md). Adapted from
[FlyTheElephant1/archive-blocks.sh](https://github.com/FlyTheElephant1/archive-blocks.sh).

## Electrum

Knots marked light clients out of scope. Upstream Fulcrum rejected Blake2b headers ([cculianu/Fulcrum#327](https://github.com/cculianu/Fulcrum/issues/327)).

**Reference:** vendor/run [Kilombino/Shulcrum](https://github.com/Kilombino/Shulcrum) — variable header length + `blockchain.pow_algorithms` / protocol 1.7. Design notes: [Kilombino/blake2b-light-clients](https://github.com/Kilombino/blake2b-light-clients).

Do **not** fork Blake2b hashing into neop. Testnet4 Electrum ports: `15001` (legacy), `15011` (blake2b).

## Replay ethos (product core)

Same network magic means wire isolation alone is not enough. Protection is layered and **default-deny**. Normative detail: **[docs/replay.md](replay.md)**.

1. Catalog labels: `core_only` | `knots_only` | `both` (replay-exposed; RPC may still say `legacy_only` / `blake2b_only`)
2. Refuse spends still valid on the non-selected tip unless unique-input, an embedded **wedge**, or `allow_dual_effect: true`
3. **Core-bound wedge:** `OP_RETURN` scriptPubKey **> 83 bytes** (invalid on Knots reduced-data / RDTS policy)
4. **Knots-bound wedge:** opt-in Knots sighash ([#357](https://github.com/bitcoinknots/bitcoin/pull/357)) when enforced
5. One-time `protectwallet` ceremony to partition `both` UTXOs; unique-input thereafter
6. Broadcast only to the selected chain’s mempool
7. Confidence receipt: `{ chain, txid, other_chain_affected: false }` (RPC may still say `flavor` / `other_flavor_affected`)

Never silent dual-broadcast. Never claim PoW alone stops replays.

## Out of scope for v1

- Profitable Blake2b mining / DATUM ops
- Lightning on both tips
- Treating stalled RDTS SHA-256 as a spend path
- testnet3 (use testnet4 only)
