# `neopd` RPC surface (spec draft)

Network enum: `testnet4` | `regtest` | `main`. Development default: **`testnet4`**.

Flavor enum for live wallet paths: `legacy` | `blake2b` (aliases for the **Core** and **Knots** chains). Optional archive: `rdts_sha256` (read-only / not for ordinary send). Prefer **Core / Knots** in UI copy; see [replay.md](replay.md) for wedges and `protectwallet`.

This is the contract for clients (dashboard, Sparrow, Shrike). Engines remain Core / Knots behind the mux — neopd does not invent consensus RPC.

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
| `flavor_presence` | `legacy_only` \| `blake2b_only` \| `both` (optional `rdts_sha256_only`; prefer documenting as Core-only / Knots-only / both) |
| `replay_risk` | `none` \| `exposed` |

Clients MUST surface presence before send. `both` coins are not spendable via ordinary send until ceremony, a unique input, or an embedded wedge exists. Full policy: [replay.md](replay.md).

## Send (replay-safe)

### `send` / `sendrawtransaction` (flavor-scoped)

Required:

- `flavor`: `legacy` | `blake2b` (Core / Knots)
- Transaction hex or wallet construction params

Behavior:

1. If the tx would still be valid on the non-selected tip → error `replay_risk_unresolved` unless unique-input, the correct chain wedge (Core: OP_RETURN scriptPubKey > 83 bytes; Knots: #357 sighash when live), or `allow_dual_effect: true` (logged / UI-gated; never the default).
2. Broadcast **only** to the selected flavor’s P2P/mempool.
3. On success, return a **confidence receipt**:

```json
{
  "flavor": "blake2b",
  "txid": "…",
  "other_flavor_affected": false
}
```

`other_flavor_affected: true` only when dual-effect was explicitly authorized. Field names may gain `chain` / `other_chain_affected` aliases later.

Never auto-broadcast the same raw tx to both flavors.

## Protect (planned)

### `protectwallet`

One-time (or re-protect) ceremony to partition `both` UTXOs. See [replay.md](replay.md).

```json
{
  "dry_run": true,
  "chains": ["core", "knots"]
}
```

Returns a plan of Core-bound (OP_RETURN > 83) and Knots-bound (#357 when available) transactions / status. Staged protect: Core pass may run before Knots #357 is live.

### `getreplaystatus` (planned)

Counts of `both` / protected / pending Knots pass (and related banners for new dual deposits).

## Electrum (adjacent, not JSON-RPC)

| Port (testnet4) | Dialect |
|-----------------|---------|
| `15001` | Legacy: classic 80-byte SHA256d (Fulcrum/electrs) |
| `15011` | Blake2b: [Shulcrum](https://github.com/Kilombino/Shulcrum) — variable headers, protocol ≥1.6 headers-as-list, `blockchain.pow_algorithms` / 1.7 |

## Implemented

| Method | Status |
|--------|--------|
| `getnetwork` | Returns `{network}` |
| `getstoreinfo` | Datadir paths + indexed block count |
| `getflavors` | Dual engine health |
| `getblockchaininfo` | Requires `flavor`; proxies pinned engine |
| `help` | Method list |

| `listcoins` | Catalog with flavor_presence / replay_risk |
| `sendrawtransaction` | Flavor-scoped; default-deny replay; confidence receipt |

Never silent dual-broadcast.

## Status

Normative intent for Phase A+; live methods grow with `neopd` slices.
