<p align="center">
  <img src="neop-hero.jpg" alt="Neapolitan ice cream — three flavors in one tub, like dual-flavor chain history in one archive" width="720">
</p>

# Neapolitan (`neop`)

Dual-flavor Bitcoin node and coin-control wallet: **legacy** (SHA-256 / Core) and **blake2b** (Knots Blake2b / BIP-110 lineage), with replay-safe spends so only the flavor you select is affected.

Published under [theSeattleUnfreeze](https://github.com/theSeattleUnfreeze). Daemon name: **`neopd`**.

> Status: identity gates + Phase A docs shipped; Phase B `neopd` scaffolding in stacked PRs. Engines stay pinned upstream — neop does not reimplement Blake2b PoW.

## Wrapper-first

| Piece | Role |
|-------|------|
| Bitcoin Core / Knots Blake2b | Pinned **validation engines** |
| `neopd` | Shared archive mux, dual chainstates, flavor RPC, replay-safe send |
| [Shulcrum](https://github.com/Kilombino/Shulcrum) | Vendored Electrum server for variable Blake2b headers |

Details: [docs/architecture.md](docs/architecture.md) · [docs/rpc.md](docs/rpc.md) · [docs/testnet4.md](docs/testnet4.md) · [docs/hosting.md](docs/hosting.md)

## What is Shulcrum?

**Shulcrum** is a fork of [Fulcrum](https://github.com/cculianu/Fulcrum) (Electrum server) for **Blake2b / v2 block headers** on the Knots hardfork lineage ([bitcoinknots/bitcoin#359](https://github.com/bitcoinknots/bitcoin/pull/359)).

Stock Electrum servers assume **fixed 80-byte SHA256d headers**. After Blake2b activation, headers can be **~164 bytes** (v2, bit 31 set). Fulcrum will not take that upstream — [cculianu/Fulcrum#327](https://github.com/cculianu/Fulcrum/issues/327) was closed without it. [Kilombino/Shulcrum](https://github.com/Kilombino/Shulcrum) (`blake2b-headers` branch) adds the server side so light clients (Sparrow, etc.) can sync a Blake2b tip without hashing every header as 80-byte SHA256d.

Knots marked light-client / Electrum work **out of scope**. neop **vendors and runs Shulcrum** — it does **not** reimplement Blake2b header hashing in `neopd`. Design notes: [Kilombino/blake2b-light-clients](https://github.com/Kilombino/blake2b-light-clients).

| | Classic Fulcrum (legacy) | Shulcrum (blake2b) |
|---|--------------------------|-------------------|
| Header size | Fixed 80 bytes | Variable 80 or 164 |
| `blockchain.block.headers` | Concatenated blob | Protocol ≥1.6: list of hex strings |
| PoW family | SHA256d only | `blockchain.pow_algorithms` (protocol 1.7) |
| Testnet4 port (planned) | `15001` | `15011` |

Same rule as blocks: **one shared pre-split Electrum index**, flavor-specific deltas after the split — not two full indexes over two full nodes.

## Privacy gates (maintainers)

This org must not leak a personal GitHub account. After clone:

```bash
cp .identity.example .identity
./identity/install-hooks.sh
github-identity anon
github-identity check
./identity/check.sh --push
```

If `.identity` is present, `pre-commit`, `commit-msg`, and `pre-push` hooks refuse operations that would use a non-anon identity. See [AGENTS.md](AGENTS.md).

Public contributors who do not need anonymity may omit `.identity` (gates stay off).

## Clone

```bash
git clone git@github.com-anon:theSeattleUnfreeze/neop.git
cd neop
```

## Testnet4 (development default)

```bash
cp .env.example .env   # set RPC passwords locally
# Engine / neopd images are placeholders until Phase B merges — see docs/testnet4.md
docker compose -f docker-compose.testnet4.yml config
```

Explorer: [mempool.guide/testnet4](https://mempool.guide/testnet4).

## License

TBD (will be set when the first feature code lands).
