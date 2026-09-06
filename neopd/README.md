# neopd — Neapolitan dual-flavor daemon

Python 3.8+ package. Wrapper around pinned Bitcoin Core / Knots engines.
Does not reimplement Blake2b PoW or consensus policy.

```bash
python -m neopd --help
python -m neopd --datadir ./data --network testnet4
```

See [docs/architecture.md](../docs/architecture.md) and [docs/store.md](../docs/store.md).
