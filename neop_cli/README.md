# neop_cli — Core-bound protect PSBT and Electrum pairing hints (stdlib).

Operator helpers for ceremony and wallet pairing. **Does not** replace `neopd` send control.

## Commands

```bash
PYTHONPATH=. python3 -m neop_cli electrum-endpoints --network testnet4
PYTHONPATH=. python3 -m neop_cli protect-psbt --help
PYTHONPATH=. python3 -m neop_cli check-signed-hex --help
```

- **`electrum-endpoints`** — Fulcrum+Sparrow (Core) and Shulcrum+Shrike (Knots) host:ports.
- **`protect-psbt`** — build an unsigned Core-bound PSBT (`OP_RETURN` scriptPubKey **> 83 bytes**) via Core/legacy `createpsbt`. Sign in Sparrow; broadcast **Core-only** (bitcoind / Fulcrum path).
- **`check-signed-hex`** — `testmempoolaccept` on Core (+ optional Knots reject oracle) after signing.

## Implementation status (vs `neopd`)

| Capability | Status |
|------------|--------|
| Wedge sizing / fee helpers | Wired in `neop_cli` |
| Knots reject oracle (`check-signed-hex`) | Wired (requires signed raw hex) |
| `neopd sendrawtransaction` wedge detection | **Not wired** — `evaluate_send` allows unique-input or `allow_dual_effect` only ([docs/replay.md](../docs/replay.md)) |
| `protectwallet` / `getreplaystatus` RPC | **Planned** in `neopd` |

Until wedge detection lands in `neopd`, Core-bound ceremony txs are **manual / out-of-band**: sign in Sparrow, broadcast via the Core engine, validate Knots rejection with `check-signed-hex`. Do not assume `neopd` will accept the signed tx for an all-`both`-input wedge spend.

## Tests

```bash
PYTHONPATH=. python3 -m unittest discover -s tests -v
```
