# Deploy on your metal (no second IBD)

Neapolitan reuses a **shared pre-split SHA-256 `blocks/` archive** so you can run the **Core** and **Knots** tips on one disk without downloading the chain twice.

## What you save vs what you still verify

| Shared / cheaper | Still your job to verify |
|------------------|---------------------------|
| One pre-split **`blocks/`** (~not 2× IBD) | Pinned engines (Core / pre-RDTS Knots + Blake2b Knots) |
| Dual **chainstates** (tens of GB each, not another ~800GB) | **Fulcrum** and **Shulcrum** binaries, config, and indexes |
| Optional shared Electrum index + flavor deltas | **Sparrow** and **[Shrike](https://github.com/privkeyio/shrike/releases)** releases |
| Compose wiring on one host | That each wallet talks to the intended Electrum tip |

neop makes dual-chain on one machine practical. It does **not** collapse trust into a single app.

## Disk layout

```text
data/<network>/
  blocks/                 # shared pre-split SHA-256 archive
  blake2b-shard/          # post-activation v2-header blocks only
  chainstate-legacy/      # Core tip chainstate
  chainstate-blake2b/     # Knots tip chainstate
  electrum/               # Fulcrum + Shulcrum data (pre-split index + deltas when wired)
```

Per-flavor tip dirs (`blocks-core/`, `blocks-knots/`) symlink into `blocks/` for shared pre-fork history — see [hosting.md](hosting.md) and [`scripts/archive-blocks.sh`](../scripts/archive-blocks.sh). Placeholders only in examples: `STARTOS_HOST`, `USB_DATADIR`, `VPS_PUBLIC_IP`.

| Asset | Reuse? | Notes |
|-------|--------|--------|
| `blocks/` (pre-split SHA-256) | **Yes** | Both engines use `-blocksdir` / this store |
| Existing `chainstate/` | **Partial** | Keep for one tip; the other tip needs its own chainstate (rebuild from blocks = hours, not IBD weeks) |
| Post–Blake2b v2 `blk` files | **Separate shard** | Cannot share classic 80-byte header layout |
| Peers / wallets | Per-engine datadir | Do not share `wallet.dat` across tips |

## Shared archive ceremony

Stop nodes before moving open `blk*.dat` files. Use [`scripts/archive-blocks.sh`](../scripts/archive-blocks.sh) (adapted from [FlyTheElephant1/archive-blocks.sh](https://github.com/FlyTheElephant1/archive-blocks.sh)) to archive pre-split `blk`/`rev` into shared `blocks/`, symlink the first tip back, and bootstrap the other flavor with `-a`. Bootstrap mode does **not** copy `blocks/index/` and does **not** touch existing `chainstate-*` or Electrum indexes. Step-by-step: [hosting.md](hosting.md#shared-pre-split-blk--rev-ceremony).

## Operator paths

### 1. You already have Core (or pre-RDTS Knots) with full blocks

1. Archive pre-split history into shared `blocks/` via `archive-blocks.sh`; keep your existing Core tip working via symlinks.
2. Bootstrap **Blake2b Knots** `blocks-knots/` with `-a` (same `blocksdir`; no second download of shared pre-fork files).
3. Sync / activate the Blake2b tip (`blake2b-shard/` after the split).
4. Build **only** `chainstate-blake2b` for the new flavor (`-reindex-chainstate` if needed). Do **not** reindex `chainstate-legacy` or shared pre-fork headers — do **not** re-download blocks.

### 2. You already have Blake2b Knots with full blocks (e.g. StartOS)

1. Copy or mount blocks onto the **Linux neop host**; run the archive ceremony into shared `blocks/` per above. StartOS remains an optional SHA-256 peer per [hosting.md](hosting.md) — not the dual-flavor wallet host.
2. Bootstrap **Core** `blocks-core/` with `-a`; run a **legacy engine** (Core v29 or pre-RDTS Knots) with shared `blocksdir` + new `chainstate-legacy`.
3. Expect a **chainstate rebuild on Core only** — not a second IBD. Do **not** reindex `chainstate-blake2b` for the side you already support.
4. Wallets: **Sparrow → Fulcrum** (Core). **Shrike → Shulcrum** (Knots). Never point stock Sparrow at Blake2b Knots RPC or at Shulcrum’s Blake2b tip.

### 3. Fresh neop compose

One shared `blocks/`; first sync is IBD **once**, then both tips share it. See [testnet4.md](testnet4.md).

## Electrum after engines are healthy

neop does **not** own Electrum ports. **Fulcrum** (`:15001` on testnet4) and **Shulcrum** (`:15011`) do. neop compose/docs help bring them up and index after IBD. Details: [electrum.md](electrum.md). Print pairing with `python -m neop_cli electrum-endpoints` when the CLI is installed.

## Ceremony without waiting on Electrum

Core-bound OP_RETURN protection can use Core RPC + Sparrow before Electrum finishes indexing. See [replay.md](replay.md) and `python -m neop_cli protect-psbt`.

## Honest constraints

- Second chainstate + Electrum indexes cost disk and CPU; still far cheaper than a second block IBD.
- StartOS Knots alone is not a full neop wallet stack.
- Verify engine pins, Fulcrum/Shulcrum builds, and Sparrow/Shrike releases yourself.
