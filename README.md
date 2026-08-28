# Neapolitan (`neop`)

Dual-flavor Bitcoin node and coin-control wallet: **legacy** (SHA-256 / Core) and **blake2b** (BIP-110 lineage), with replay-safe spends so only the flavor you select is affected.

Published under [theSeattleUnfreeze](https://github.com/theSeattleUnfreeze). Daemon name: **`neopd`**.

> Status: repository bootstrap. Identity / privacy gates land first; node and wallet features follow.

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

## License

TBD (will be set when the first feature code lands).
