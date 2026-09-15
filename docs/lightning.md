# Lightning migration (Neop digest)

Neop and Scoop catalog **wallet** UTXOs across Core and Knots. They do **not** implement
Lightning migration tooling (forkward, CLN adapters, mirror broadcast).

**Standard for splitting Lightning channels:** follow chrisguida’s master plan (source of truth):

- https://gist.github.com/chrisguida/819e2725927e49934a583184b222bc71
  (*Lightning on the BLAKE2b Chain — The Rescue Plan*, Rev 3)

That gist (and its linked CLN runbook / `GRAND_PLAN`) owns channel triage, dual-chain closes,
spam-anchored settlement, and operator runbooks. This page maps that doctrine into Neop naming
and points operators at the right order of operations.

## Terminology

| Gist term | Neop term |
|-----------|-----------|
| Bitcoin / blake / BLAKE2b chain | **Knots** (`flavor=blake2b`) |
| Spamcoin / spamchain / SHA256d altcoin | **Core** (`flavor=legacy`) |
| `SIGHASH_UNIFIED` (`0x20`; Taproot key-path often `0x21`) | Knots-bound sighash wedge ([Knots #357](https://github.com/bitcoinknots/bitcoin/pull/357)) |
| Taint input / dust pool | **Unique-input** / one-chain ancestry after a differential spend |
| OP_RETURN garnish (scriptPubKey > 83) | Temporary RDTS Core-invalidating output — **not** lasting Core protection |
| Split Bitcoin-first | Spend **Knots first** (unified sigs) before touching Core twins |
| Dual-chain / latent dual-chain channel | Funding outpoint that exists (or is still valid) on both tips |

Mantra (adapted from the gist): **catalog says what you hold; sighash says where Knots txs are
valid; input existence (taint) binds a tx to one chain in either direction.**

## Constants (from the gist)

| Fact | Value |
|------|--------|
| Last shared block | 961,631 |
| Split (first divergent Core / Spamcoin block) | **961,632** (2026-08-08) |
| Knots / BLAKE2b HF | **961,640** (2026-08-30) |
| RDTS reduced-data expiry | **2027-09-01 00:00 UTC** (fixed timestamp) |
| Settlement / infra backstop (gist policy) | **2027-06-01** (RDTS − 90 days) |

## Situation (compressed)

Pre-split channels share one genesis `chain_hash`. Operate/close messages (`channel_reestablish`,
commitments, `shutdown`, `closing_signed`) carry **no** chain id. Core/Spamcoin shipped **no**
replay protection, so pre-split (and many latent) channels exist on **both** tips until the
funding outpoint is spent on each.

A stock Core-backed Lightning node follows Core only (it cannot parse 164-byte Knots headers).
A Knots-backed node without a fork-aware Lightning build may be frozen or crashed. Fork-aware
CLN on Knots is a small, growing set — see the gist for builds and verification.

### Three ways to lose money

1. **HTLC divergence** — peers on different tips with an HTLC in flight can claim success on one
   chain and timeout on the other.
2. **Revoked-state replay** — old commitments remain broadcastable on the tip you are not watching
   until funding is spent on **both** chains.
3. **Wallet-spend split-order trap** — sweeping Core/Spamcoin twins **before** a Knots-only spend
   of the shared UTXO can replay onto Knots and move real Bitcoin. Safe order: **Knots first**
   (unified signature), then Core.

## What to do (operator order)

With **zero** new Neop software:

1. Back up node secrets / channel DB off-box.
2. Close channels with peers who will not follow you to Knots (cooperative close is dual-valid;
   broadcast on both tips).
3. Turn off forwarding; drain in-flight HTLCs to zero **before** switching chain backends.
4. For plain wallet UTXOs: split **Knots first**, then handle Core — see [replay.md](replay.md)
   (taint / unique-input is the lasting Core-side guarantee; OP_RETURN > 83 is RDTS-window only).

Scoop can label wallet presence (`core_only` / `knots_only` / `both`) and surface split to-dos.
It does not watch channel funding for you and does not dual-broadcast Lightning closes.

## Two exits for every pre-split channel

| Exit | When | Effect |
|------|------|--------|
| **A — Close on both chains** | Default; any peer | Funding spent on both tips; balances become plain UTXOs. |
| **B — Spam-anchored settlement** | Fork-aware peers only | Resolve Core/Spamcoin with a **taint** input (mandatory); keep the channel live on Knots. OP_RETURN garnish optional, never alone. |

Mechanics, TLVs, dust-pool minting, `option_blake2b` / `option_unified_sigs`, and the 14-day
anti-stall rule are specified in the gist — not in Neop.

## Neop scope vs Lightning scope

| Layer | Owns |
|-------|------|
| **Neop / Scoop** | Dual-tip wallet catalog, default-deny send, wallet split ceremony (unsigned plans), Electrum mux docs |
| **Gist / forkward / CLN fork** | Channel migration, mirror broadcast, justice on both tips, settlement dance, appliance packaging |

Do **not** treat Neop `protectwallet` / Scoop Split as a Lightning channel migrator.

## Related docs

- [replay.md](replay.md) — wallet send-control, taint / unique-input, temporary OP_RETURN garnish
- [architecture.md](architecture.md) — wrapper-first; Lightning tooling out of Neop v1 scope
- [scoop.md](scoop.md) — watch-only catalog UI
- [wallets.md](wallets.md) — Sparrow / Shrike paths
