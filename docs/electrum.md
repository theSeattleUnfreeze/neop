# Electrum — Fulcrum (Core) and Shulcrum (Knots)

Two ports, two servers. **neop orchestrates**; it does **not** speak Electrum or own these ports.

| Network | Core (Fulcrum) | Knots (Shulcrum) |
|---------|----------------|------------------|
| testnet4 | **15001** | **15011** |
| regtest | 25001 | 25011 |
| main | 50001 | 50011 |

## Fulcrum (Core chain) — required

Use **[Fulcrum](https://github.com/cculianu/Fulcrum)** against the legacy / Core engine for classic **80-byte SHA-256d** headers.

**Do not recommend electrs** (or other classic Electrum servers) in neop deployments. Fulcrum is the supported Core-side indexer.

## Shulcrum (Knots chain) — required

Vendor/run [Kilombino/Shulcrum](https://github.com/Kilombino/Shulcrum) (`blake2b-headers`):

- Variable header length (80 or ~164) per version bit 31
- Protocol ≥1.6: `blockchain.block.headers` as a **list of hex strings**
- Protocol **1.7** + `blockchain.pow_algorithms` (`sha256d`, then `blake2b-v2`)

Design notes: [Kilombino/blake2b-light-clients](https://github.com/Kilombino/blake2b-light-clients). Upstream Fulcrum declined variable Blake2b headers ([cculianu/Fulcrum#327](https://github.com/cculianu/Fulcrum/issues/327)).

Wallet client for this port: **[Shrike](https://github.com/privkeyio/shrike/releases)** — not stock Sparrow. See [wallets.md](wallets.md).

## Post-IBD bring-up (operator)

1. Both engines healthy on the shared `blocks/` layout ([deploy-metal.md](deploy-metal.md)).
2. Start **Fulcrum** against the Core/legacy RPC; wait for the initial index (long once, then incremental).
3. Start **Shulcrum** against the Blake2b/Knots RPC; build or extend indexes / flavor deltas.
4. Point **Sparrow → Fulcrum**, **Shrike → Shulcrum**.
5. Optional: `python -m neop_cli electrum-endpoints` to print host/ports and pairing.

Compose stubs (when Phase B Electrum wiring is merged) should map host ports `15001` / `15011` to the container Electrum listeners. Pin Fulcrum and Shulcrum commits when publishing images.

## Trust

You still verify Fulcrum and Shulcrum builds and that each wallet is connected to the intended server before broadcasting. Shared block storage does not replace that check.

Clone/build: [vendor/README.md](../vendor/README.md) (Shulcrum); Fulcrum per [upstream README](https://github.com/cculianu/Fulcrum).
