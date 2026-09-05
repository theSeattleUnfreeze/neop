# Vendored / external engines

Neapolitan pins and runs upstream tools. Do **not** fork Blake2b PoW into this repository.

## Shulcrum (Blake2b Electrum)

Reference: https://github.com/Kilombino/Shulcrum (branch `blake2b-headers`)

```bash
git clone https://github.com/Kilombino/Shulcrum.git vendor/Shulcrum
cd vendor/Shulcrum
git checkout blake2b-headers
# Build/run per upstream README. Point at the blake2b Knots node + neop datadir electrum index.
# Listen on testnet4 port 15011 (see docs/electrum.md).
```

Required dialect surfaces:

- `extended_headers` / variable header I/O
- `blockchain.pow_algorithms`
- max protocol 1.7

`vendor/Shulcrum/` is gitignored when cloned locally; pin a commit hash in compose when an image is published.

## Fulcrum (Core Electrum)

Use **[Fulcrum](https://github.com/cculianu/Fulcrum)** only on port 15001 (testnet4) — classic 80-byte SHA-256d headers. Do not recommend electrs in neop deployments. Build/run per upstream README; point at the Core/legacy engine RPC and neop datadir Electrum index when wired.
