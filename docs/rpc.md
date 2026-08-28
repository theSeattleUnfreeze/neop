# `neopd` RPC surface (spec draft)

Network enum: `testnet4` | `regtest` | `main`. Development default: **`testnet4`**.

Flavor enum for live wallet paths: `legacy` | `blake2b`. Optional archive: `rdts_sha256` (read-only / not for ordinary send).

This is the contract for clients (dashboard, Sparrow). Engines remain Core / Knots behind the mux — neopd does not invent consensus RPC.

## Discovery

### `getflavors`

Returns configured tips and health.

```json
{
  "network": "testnet4",
  "flavors": {
    "legacy": { "engine": "bitcoin-core", "status": "ok", "blocks": 0, "headers": 0 },
    "blake2b": { "engine": "bitcoin-knots-blake2b", "status": "ok", "blocks": 0, "headers": 0 }
  }
}
```

### `getblockchaininfo`

Requires `flavor`. Proxies/scopes the matching engine tip + chainstate. Response MUST include enough for clients to distinguish header families without guessing (e.g. `header_version` / raw header length once Blake2b is live — see Knots [#363](https://github.com/bitcoinknots/bitcoin/pull/363)).

## Coin catalog

### `listcoins` / coin-control list

Every UTXO includes:

| Field | Values |
|-------|--------|
| `flavor_presence` | `legacy_only` \| `blake2b_only` \| `both` (optional `rdts_sha256_only`) |
| `replay_risk` | `none` \| `exposed` |

Clients MUST surface presence before send. `both` coins are not spendable via ordinary send until ceremony or a unique input exists.

## Send (replay-safe)

### `send` / `sendrawtransaction` (flavor-scoped)

Required:

- `flavor`: `legacy` | `blake2b`
- Transaction hex or wallet construction params

Behavior:

1. If the tx would still be valid on the non-selected tip → error `replay_risk_unresolved` unless `allow_dual_effect: true` (logged / UI-gated; never the default).
2. Broadcast **only** to the selected flavor’s P2P/mempool.
3. On success, return a **confidence receipt**:

```json
{
  "flavor": "blake2b",
  "txid": "…",
  "other_flavor_affected": false
}
```

`other_flavor_affected: true` only when dual-effect was explicitly authorized.

Never auto-broadcast the same raw tx to both flavors.

## Electrum (adjacent, not JSON-RPC)

| Port (testnet4) | Dialect |
|-----------------|---------|
| `15001` | Legacy: classic 80-byte SHA256d (Fulcrum/electrs) |
| `15011` | Blake2b: [Shulcrum](https://github.com/Kilombino/Shulcrum) — variable headers, protocol ≥1.6 headers-as-list, `blockchain.pow_algorithms` / 1.7 |

## Status

Stub: methods and error codes will gain concrete JSON schemas as `neopd` lands. Until then, treat this document as the normative intent for Phase A.
