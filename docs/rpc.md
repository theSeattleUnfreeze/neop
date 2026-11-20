# `neopd` RPC surface (spec draft)

Network enum: `testnet4` | `regtest` | `main`. Development default: **`testnet4`**.

Flavor enum for live wallet paths: `legacy` | `blake2b` (aliases for the **Core** and **Knots** chains). Optional archive: `rdts_sha256` (read-only / not for ordinary send). Prefer **Core / Knots** in UI copy; see [replay.md](replay.md) for taint / wedges and `protectwallet`. Lightning channels: [lightning.md](lightning.md).

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

Clients MUST surface presence before send. `both` coins are not spendable via ordinary send until ceremony, a **unique input (taint)**, or an embedded wedge exists. Full policy: [replay.md](replay.md).

## Send (replay-safe)

### `send` / `sendrawtransaction` (flavor-scoped)

Required:

- `flavor`: `legacy` | `blake2b` (Core / Knots)
- Transaction hex or wallet construction params

Behavior:

1. If the tx would still be valid on the non-selected tip → error `replay_risk_unresolved` unless **unique-input (taint)**, `allow_dual_effect: true`, (Core / `legacy` only) an embedded OP_RETURN scriptPubKey **> 83 bytes** in `hex` (**RDTS garnish**, temporary), or (Knots / `blake2b` only) a Taproot key-path witness signature ending in **0x21** when #357 is enforced. See [replay.md](replay.md).
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

## Protect

### `protectwallet`

Dry-run plan for partitioning `both` coins. See [replay.md](replay.md).

```json
{ "dry_run": true }
```

The result lists each `both` coin in Knots-then-Core order. `psbts` is empty, `broadcast` is false, and `other_flavor_affected` is false. `dry_run: false` does not build a transaction either. `neopd` does not hold keys. Sign in Shrike or Sparrow.

### `getreplaystatus`

Counts of `both`, `legacy_only`, `blake2b_only`, and `pending_knots_pass`. `protected` is 0 because there is no ceremony ledger. No keys.

## Electrum (adjacent, not JSON-RPC)

| Port (testnet4) | Dialect |
|-----------------|---------|
| `15001` | Core: **Fulcrum** (classic 80-byte SHA256d) — not electrs |
| `15011` | Knots: [privkeyio Fulcrum](https://github.com/privkeyio/Fulcrum/releases/tag/v2.1.2-blake-3) (or [Shulcrum](https://github.com/Kilombino/Shulcrum)) — variable headers, protocol ≥1.6 |

Client pairing: Sparrow → Core Fulcrum; Shrike → Knots Electrum. See [wallets.md](wallets.md), [electrum.md](electrum.md).

## Implemented

| Method | Status |
|--------|--------|
| `getnetwork` | Returns `{network}` |
| `getstoreinfo` | Datadir paths + indexed block count |
| `getflavors` | Dual engine health |
| `getblockchaininfo` | Requires `flavor`; proxies pinned engine |
| `help` | Method list |
| `listcoins` | Catalog with flavor_presence / replay_risk |
| `sendrawtransaction` | Flavor-scoped; default-deny replay; unique-input (taint) / `allow_dual_effect` / Core OP_RETURN garnish (>83, RDTS-window) when `flavor=legacy`; Knots 0x21 unified sighash when `flavor=blake2b`; confidence receipt |
| `protectwallet` | Dry-run Knots-then-Core plan. Does not build a PSBT or broadcast. |
| `getreplaystatus` | Catalog counts. `protected` stays 0. |

Never silent dual-broadcast.

## Status

Normative intent for Phase A+; live methods grow with `neopd` slices.
