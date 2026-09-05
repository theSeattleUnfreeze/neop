# Testnet4 path

**Network default for development:** Bitcoin Testnet4 (not testnet3, not mainnet).

Explorer of record: [https://mempool.guide/testnet4](https://mempool.guide/testnet4).

No mainnet datadir or real-value spends until the acceptance checklist below passes — including isolation proofs.

## Compose stub

See [`docker-compose.testnet4.yml`](../docker-compose.testnet4.yml).

Intended services (images pinned when engines land):

| Service | Role |
|---------|------|
| `bitcoind-legacy` | Bitcoin Core `-testnet4` (legacy engine) |
| `bitcoind-blake2b` | Knots pinned to Blake2b hardfork work (`-testnet4`) |
| `neopd` | Mux + replay-safe RPC (localhost) |
| Electrum (later) | Legacy `:15001`, Blake2b/Shulcrum `:15011` |

Datadirs under `./data/testnet4/{blocks,chainstate-legacy,chainstate-blake2b,electrum}` — never reuse a mainnet volume.

Copy `.env.example` → `.env` for local RPC credentials (gitignored). Placeholders only in docs.

## Two proof layers

1. **Shared-history / wallet path (public Testnet4).** Sync Core + Knots against public testnet4. Exercise shared store, flavor-scoped RPC, and Electrum while tips still follow SHA-256 (pre–Blake2b activation on that chain). Confirm faucet txs on mempool.guide/testnet4.
2. **Blake2b divergence (CI + local).** Prove v2 headers / PoW with Knots `#359` **regtest** (`-testactivationheight=blake2b@N`, required headline). Promote to public testnet4 when upstream sets `Blake2bHeight` for that chain.

Regtest does not replace testnet4 for wallet UX; testnet4 does not replace regtest for Blake2b header correctness.

## Acceptance checklist (blocks mainnet)

- [ ] Core and Knots reach the same public testnet4 tip (or documented Blake2b tip once active).
- [ ] `neopd getflavors` / dual `getblockchaininfo` healthy.
- [ ] Shared store has one copy of shared SHA-256 history; disk size is not ~2× a single node.
- [ ] Electrum ports return history for a faucet-funded address on both flavors.
- [ ] Coin catalog labels `legacy_only`/`core_only`, `blake2b_only`/`knots_only`, and `both` correctly after a controlled split ([replay.md](replay.md)).
- [ ] Replay-exposed spend is refused without unique-input, wedge, or explicit dual-effect authorization ([replay.md](replay.md)).
- [ ] **Isolation proof:** after a flavor-scoped send, the other tip’s balance/UTXO set is unchanged and the other mempool does not contain the txid ([replay.md](replay.md)).
- [ ] Confidence receipt returned (`other_flavor_affected: false`; see [replay.md](replay.md)).
- [ ] Pasting the same raw tx into the other flavor’s RPC fails accept/mempool.
- [ ] Clients can send tBTC on the chosen flavor; explorer links resolve on mempool.guide/testnet4.
- [ ] No mainnet RPC URLs or datadirs in the testnet4 compose profile.
