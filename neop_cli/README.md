# neop_cli — Core-bound protect PSBT and Electrum pairing hints (stdlib).

Operator helpers for ceremony and wallet pairing. **Does not** replace `neopd` send control.

## Commands

```bash
PYTHONPATH=. python3 -m neop_cli electrum-endpoints --network testnet4
PYTHONPATH=. python3 -m neop_cli protect-psbt --help
PYTHONPATH=. python3 -m neop_cli check-signed-hex --help
```

- **`electrum-endpoints`** — Fulcrum+Sparrow (Core) and Shulcrum+Shrike (Knots) host:ports.
- **`protect-psbt`** — build an unsigned Core-bound PSBT (`OP_RETURN` scriptPubKey **> 83 bytes**) via Core/legacy `createpsbt`. Sign in Sparrow; broadcast via Core engine **or** `neopd sendrawtransaction` with `flavor=legacy` (catalogued inputs). Never dual-broadcast.
- **`check-signed-hex`** — `testmempoolaccept` on Core (+ optional Knots reject oracle) after signing.

## Implementation status (vs `neopd`)

| Capability | Status |
|------------|--------|
| Wedge sizing / fee helpers | Wired in `neop_cli` |
| Knots reject oracle (`check-signed-hex`) | Wired (requires signed raw hex) |
| `neopd sendrawtransaction` Core OP_RETURN wedge detection | Wired for `flavor=legacy` (`neopd.wedges`) |
| Knots #357 sighash wedge in `neopd` | Wired for `flavor=blake2b` (65-byte witness item ending in `0x21`) |
| `protectwallet` / `getreplaystatus` RPC | **Planned** in `neopd` |

Core-bound ceremony: build with `protect-psbt`, sign in Sparrow, broadcast via Core engine **or** `neopd sendrawtransaction` with `flavor=legacy` once inputs are in the catalog. Validate Knots rejection with `check-signed-hex`. A Knots-bound spend of a `both` coin is allowed when the witness carries sighash `0x21`. `neopd` reads that byte; the Knots node still enforces the signature.

## Tests

```bash
PYTHONPATH=. python3 -m unittest discover -s tests -v
```
