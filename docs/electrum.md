# Electrum for Neapolitan

Two ports, two dialects. neopd does **not** implement Blake2b hashing — it vendors/runs servers that already speak the right protocol.

| Network | Legacy port | Blake2b port |
|---------|-------------|--------------|
| testnet4 | 15001 | 15011 |
| regtest | 25001 | 25011 |
| main | 50001 | 50011 |

## Legacy (`flavor=legacy`)

Classic Fulcrum / electrs assumptions: fixed 80-byte SHA256d headers.

## Blake2b (`flavor=blake2b`)

Vendor/run [Kilombino/Shulcrum](https://github.com/Kilombino/Shulcrum) (`blake2b-headers`):

- Variable header length (80 or 164) per bit 31
- Protocol ≥1.6: `blockchain.block.headers` as a **list of hex strings**
- Protocol **1.7** + `blockchain.pow_algorithms` advertising `sha256d` then `blake2b-v2`

Design notes: [Kilombino/blake2b-light-clients](https://github.com/Kilombino/blake2b-light-clients). Upstream Fulcrum rejected the ask ([cculianu/Fulcrum#327](https://github.com/cculianu/Fulcrum/issues/327)).

See [vendor/README.md](../vendor/README.md) for clone/run steps.
