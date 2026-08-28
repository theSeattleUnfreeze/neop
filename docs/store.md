# Shared datadir layout

Contract for `data/<network>/` used by `neopd`. One SHA-256 archive for shared history; Blake2b post-activation blocks live in a separate shard. PoW validation stays in pinned engines.

## Layout

```
data/
  <network>/          # testnet4 | regtest | main
    blocks/           # shared pre-split (and shared SHA-256) blk archive
    blake2b-shard/    # post–Blake2b-activation v2-header blocks only
    rdts-shard/       # optional stalled RDTS SHA-256 tip (archive)
    chainstate-legacy/
    chainstate-blake2b/
    electrum/
      delta-legacy/
      delta-blake2b/
    block-index.json  # hash -> {header_version, shard, offset, size}
```

## Header routing (not PoW)

| Signal | Meaning |
|--------|---------|
| Header length 80 | `v1` → `blocks/` |
| Header length 164 | `v2` → `blake2b-shard/` |
| `nVersion` bit 31 set | `v2` (Knots HeaderV2 / #359) |

`neopd` classifies headers only to choose a shard. Blake2b `GetHash`, ASIC profiles, and consensus checks are delegated to Knots.

## CLI

```bash
python -m neopd --ensure-store --datadir ./data --network testnet4
```
