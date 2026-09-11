# Electrum — Core Fulcrum and Knots Fulcrum / Shulcrum

Two servers (one per tip). **neop orchestrates**; it does **not** speak Electrum or own these ports.

| Network | Core Electrum | Knots Electrum |
|---------|---------------|----------------|
| testnet4 (neop compose) | **15001** | **15011** |
| regtest | 25001 | 25011 |
| main (self-hosted Linux defaults) | **50001** (tcp) / **50002** (ssl) | **50001** (tcp) / **50002** (ssl) *on the Knots host* |

Self-hosted Linux Fulcrum defaults match upstream: plaintext **50001**, SSL **50002**. Each tip needs its **own** Fulcrum process/datadir pointed at that tip’s bitcoind — do not share one index across Core and Knots after the split.

## Hosting presets (Scoop / wallets)

| Host | How ports work | What to put in `FULCRUM_URL` / `SHULCRUM_URL` |
|------|----------------|-----------------------------------------------|
| **Self-hosted Linux** | Operator picks binds; Fulcrum defaults **tcp `50001`**, **ssl `50002`** | e.g. `tcp://127.0.0.1:50001`, `ssl://127.0.0.1:50002` |
| **StartOS** | **Dynamic** LAN/Tor ports from **Interfaces** (often not 50001/50002). Copy the `ssl://host:port` shown for **Electrum (SSL)** — do not assume a fixed number. Common StartOS Bitcoin RPC LAN port is **57747**; Electrum SSL is assigned separately (example: `49436`). Prefer the **raw LAN IP** if `.local` mDNS fails. | e.g. `ssl://192.168.0.13:49436` (your Interfaces URL) |
| **Umbrel** | Service UI shows Electrum host/port (often Tor + LAN). Use the address Umbrel prints; plaintext vs SSL depends on the app. | Copy from Umbrel → Fulcrum / Electrum service |

Scoop accepts `tcp://`, `ssl://`, and `tls://`. StartOS Fulcrum packages expose **SSL only** off-box; set `SCOOP_ELECTRUM_TLS_INSECURE=1` (default in compose) when trusting the StartOS self-signed cert on a private LAN.

## Core chain — Fulcrum

Use **[Fulcrum](https://github.com/cculianu/Fulcrum)** (or a Blake2b-capable build such as [privkeyio/Fulcrum](https://github.com/privkeyio/fulcrum) pointed at a **Core-only** tip — it never sees v2 headers there) against the Core / SHA-256d engine.

**Do not recommend electrs** in neop deployments.

## Knots chain — Blake2b-capable Fulcrum or Shulcrum

Preferred for StartOS / packaged Blake2b: **[privkeyio/Fulcrum](https://github.com/privkeyio/fulcrum)** (and [fulcrum-startos](https://github.com/privkeyio/fulcrum-startos)) — variable headers, SSL Electrum, signed releases.

Alternative: [Kilombino/Shulcrum](https://github.com/Kilombino/Shulcrum) (`blake2b-headers`). Clone/build: [vendor/README.md](../vendor/README.md).

- Variable header length (80 or ~164) per version bit 31
- Protocol ≥1.6: `blockchain.block.headers` as a **list of hex strings**
- Shulcrum may also expose protocol **1.7** + `blockchain.pow_algorithms`; privkeyio Fulcrum currently tops out at **1.6** with correct header hashing

Wallet client for Knots: **[Shrike](https://github.com/privkeyio/shrike/releases)** — not stock Sparrow. See [wallets.md](wallets.md).

## Post-IBD bring-up (operator)

1. Both engines healthy on the shared `blocks/` layout ([deploy-metal.md](deploy-metal.md)).
2. Start **Fulcrum** against the Core engine RPC; wait for the initial index.
3. Start **Blake2b Fulcrum or Shulcrum** against the Knots engine RPC.
4. Point **Sparrow → Core Fulcrum**, **Shrike → Knots Electrum**.
5. Optional: `python -m neop_cli electrum-endpoints` to print host/ports and pairing.

Compose stubs map testnet4 `15001` / `15011` when Electrum images are wired. Pin Fulcrum / Shulcrum commits when publishing images.

## Trust

Verify builds and that each wallet is connected to the intended tip before broadcasting. Shared block storage does not replace that check.

Clone/build: [vendor/README.md](../vendor/README.md); Fulcrum per upstream or privkeyio README.
