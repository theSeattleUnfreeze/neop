# Neapolitan (`neop`)

Dual-flavor Bitcoin node and coin-control wallet: **legacy** (SHA-256 / Core) and **blake2b** (Knots Blake2b / BIP-110 lineage), with replay-safe spends so only the flavor you select is affected.

Published under [theSeattleUnfreeze](https://github.com/theSeattleUnfreeze). Daemon name: **`neopd`**.

> Status: identity gates shipped; Phase A docs + testnet4 compose stub. Engines stay pinned upstream — neop does not reimplement Blake2b PoW.

## Wrapper-first

| Piece | Role |
|-------|------|
| Bitcoin Core / Knots Blake2b | Pinned **validation engines** |
| `neopd` | Shared archive mux, dual chainstates, flavor RPC, replay-safe send |
| [Shulcrum](https://github.com/Kilombino/Shulcrum) | Vendored Electrum for variable Blake2b headers |

Details: [docs/architecture.md](docs/architecture.md) · [docs/rpc.md](docs/rpc.md) · [docs/testnet4.md](docs/testnet4.md) · [docs/hosting.md](docs/hosting.md)

## Privacy gates (maintainers)

This org must not leak a personal GitHub account. Install the identity CLI from [theSeattleUnfreeze/github-identity](https://github.com/theSeattleUnfreeze/github-identity), then after cloning neop:

```bash
# once per machine (if github-identity is not on PATH):
#   git clone git@github.com-anon:theSeattleUnfreeze/github-identity.git
#   cd github-identity && ./install.sh

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
# Engine / neopd images are placeholders until Phase B — see docs/testnet4.md
docker compose -f docker-compose.testnet4.yml config
```

Explorer: [mempool.guide/testnet4](https://mempool.guide/testnet4).

## License

TBD (will be set when the first feature code lands).
