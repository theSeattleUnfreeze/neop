# Wallets — Sparrow (Core) and Shrike (Knots)

There is **no in-app Preferred Server “flavor toggle.”** Install **two** wallet apps and open the one that matches the tip you intend to use.

## Endorsed pairing

| Chain | Electrum server (owns the port) | Wallet app |
|-------|----------------------------------|------------|
| **Core** (SHA-256d) | **[Fulcrum](https://github.com/cculianu/Fulcrum)** on **`:15001`** (testnet4) | **[Sparrow](https://sparrowwallet.com)** (or another SHA-256d Bitcoin wallet) |
| **Knots** (Blake2b) | **[privkeyio Fulcrum v2.1.2-blake-3](https://github.com/privkeyio/Fulcrum/releases/tag/v2.1.2-blake-3)** (or [Shulcrum](https://github.com/Kilombino/Shulcrum)) on **`:15011`** (testnet4) | **[Shrike](https://github.com/privkeyio/shrike/releases)** |

**How to “toggle”:** open **Sparrow** for Core spends; open **Shrike** for Knots spends. The same seed/descriptors may be imported into both. Do not flip Preferred Server inside stock Sparrow to a Blake2b Electrum tip and expect stock Sparrow to validate.

### Shrike

[Shrike](https://github.com/privkeyio/shrike) is an unofficial community Blake2b / v2-header fork of Sparrow (not affiliated with upstream Sparrow). Install from **[GitHub Releases](https://github.com/privkeyio/shrike/releases)** and verify checksums/signatures when published.

### Why stock Sparrow + Blake2b Electrum is not enough

Electrum clients verify header PoW themselves. Stock Sparrow expects **80-byte SHA-256d** headers. After Blake2b activation, headers are **~164 bytes** with **Blake2b** PoW. **privkeyio Fulcrum** or **Shulcrum** fixes the server; **Shrike** fixes the client. Pointing vanilla Sparrow at Blake2b Knots RPC fails the same way (`does not meet its claimed proof of work target`).

## Hard rules

- Never point vanilla Sparrow (RPC or Electrum) at the Blake2b Knots tip.
- Core Electrum = **Fulcrum only** (do not use electrs with neop).
- Broadcast Core-bound OP_RETURN ceremony txs only from Sparrow on the Core/Fulcrum path.
- Replay-exposed (`both`) coins: use `neop_cli protect-psbt` / later `protectwallet` — see [replay.md](replay.md).

## Connection checklist

1. Engines synced; Core Fulcrum and Knots Electrum (privkeyio Fulcrum or Shulcrum) indexed ([electrum.md](electrum.md)).
2. In Sparrow: private Electrum → Fulcrum host/`15001` (TLS as configured).
3. In Shrike: private Electrum → Knots Electrum host/`15011`.
4. Confirm tip/height in each app before sending.

### Electrum / xpub for Scoop

Scoop Electrum-linked **wallets** prefer a Sparrow **account xpub** (auto-expands receive
addresses). Advanced: paste one Bitcoin address. See
[scoop.md — Linking a Sparrow wallet](scoop.md#linking-a-sparrow-or-shrike-wallet).

Print host/port hints: `python -m neop_cli electrum-endpoints`.

## Related

- [deploy-metal.md](deploy-metal.md) — shared blocks, no second IBD
- [electrum.md](electrum.md) — Core Fulcrum / Knots Electrum lifecycle
- [replay.md](replay.md) — wedges and ceremony
