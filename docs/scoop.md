# Scoop

Optional **read-only** dual-tip wallet UI for Neapolitan (`neop`). Catalogs which coins exist on
**Core**, **Knots**, or **both**; shows movement per tip; surfaces likely **Spills** and
**replay receives**; organizes wallet locations and split to-dos on a self-hosted dashboard.

Scoop does **not** sign, broadcast, or speak Electrum to wallets. It watches your Core and Knots
Electrum servers (`FULCRUM_URL` / `SHULCRUM_URL`) and stores results in local Postgres.

Default **testnet4** examples use `:15001` / `:15011`. For **mainnet** presets (self-hosted Linux
`50001`/`50002`, StartOS dynamic SSL, Umbrel), see [electrum.md](electrum.md#hosting-presets-scoop--wallets).

## Self-hosted privacy (non-negotiable)

Scoop sits next to your own Core / Knots engines — same trust boundary as Sparrow/Shrike → your node.

- **Operator-owned runtime** — no SaaS, no hosted Scoop, no telemetry
- **Default bind `127.0.0.1:3847`** — do not expose without auth (v1 has none)
- **Local Electrum only** — `FULCRUM_URL` / `SHULCRUM_URL` point at your Fulcrum / Shulcrum
- **No private keys** — notes may describe wallet locations; keep them on this host
- Postgres holds xpubs/scripthashes/notes — treat the DB as sensitive

### Install matrix

| Platform | Path |
|----------|------|
| Linux / macOS | **pnpm** in `scoop/` |
| Windows | **Docker Compose** (`docker-compose.scoop.yml --profile scoop`) |
| Any | Docker optional (Postgres + Scoop; Electrum on host) |

```bash
# Unix / macOS (preferred)
cd scoop && cp .env.example .env && pnpm install && pnpm test && pnpm run db:migrate && pnpm run dev
# http://127.0.0.1:3847

# Windows / Docker
docker compose -f docker-compose.scoop.yml --profile scoop up --build
# UI + Postgres on loopback only
```

## Threat model

- xpubs / descriptors / addresses are sensitive. Default bind: **`127.0.0.1:3847`**.
- Do not expose Scoop on a public interface without auth (v1 has no auth).
- No private keys are stored.
- Organizer notes/reminders can name physical wallet locations — localhost-only default.

## Env

See [`scoop/.env.example`](../scoop/.env.example):

| Variable | Purpose |
|----------|---------|
| `SCOOP_DATABASE_URL` | Postgres (required for dashboard / wallets / tasks / notifications) |
| `FULCRUM_URL` | Core Electrum (`tcp://` or `ssl://`) |
| `SHULCRUM_URL` | Knots Electrum — Blake2b Fulcrum or Shulcrum (`tcp://` or `ssl://`) |
| `SCOOP_BIND` | Host/port for the Next server |
| `SCOOP_ELECTRUM_TLS_INSECURE` | `1` (default in compose) to accept StartOS self-signed Electrum TLS; `0` to verify CA |

### StartOS / Umbrel / Linux examples

```bash
# Self-hosted Linux Fulcrum defaults (one process per tip / host)
FULCRUM_URL=tcp://127.0.0.1:50001
SHULCRUM_URL=ssl://127.0.0.1:50002

# StartOS Knots Fulcrum — copy Electrum (SSL) from Interfaces; use LAN IP if *.local fails
SHULCRUM_URL=ssl://192.168.0.13:49436
SCOOP_ELECTRUM_TLS_INSECURE=1
# StartOS Bitcoin Knots RPC LAN is commonly :57747 (not Electrum)

# Umbrel — paste host/port from the Fulcrum / Electrum app UI
```

## Linking a Sparrow (or Shrike) wallet

A **wallet** in Scoop is an xpub plus derivation path (a collection of addresses). An
**account** can later group several wallets. Coins live at addresses; we watch those
addresses on both tips.

### Least lift: paste the xpub

1. In **Sparrow** / **Shrike**: open the wallet → copy the **account Extended Public Key**
   (Settings / wallet settings → Copy Extended Public Key — `zpub` / `ypub` / `xpub`).
2. Scoop → **Wallets** → **+ Add a wallet** (the form is already open if you have none yet).
3. Choose **Entire wallet**, paste the xpub, then Next. Derivation path is optional.
4. Scoop checks the first **50** receive addresses. If none have history, it asks you to raise
   that count (large gap) or double-check the key.
5. Add wallet. Scoop syncs Electrum automatically and opens the wallet as an address table.

**Viewing coins:** open the wallet. Filter chips **All / Core / Knots / Spills** hide rows; they are not separate pages.

Shrike only talks to **Knots** Electrum (`SHULCRUM_URL`). Scoop also queries **Core** Fulcrum (`FULCRUM_URL`). If Core Fulcrum is down or still indexing, the Core column can be empty while Knots (and Shrike) show a balance. That does not mean the xpub is invalid.

Scoop treats the key as Sparrow’s **account-level** xpub and watches receive addresses
`0/0` … `0/N-1` (default N=50). Optional: watch change `1/i`, or override path. The receive
count lives under **Advanced settings**.

| Key prefix | Default assumption |
|------------|--------------------|
| `zpub` / `vpub` | Native segwit `m/84'/…` |
| `ypub` / `upub` | Nested segwit `m/49'/…` |
| `xpub` / `tpub` | Auto-detect: probe the first ~8 addresses as native / taproot / nested / legacy on your Electrum tips; if none hit, default native segwit |

**Path override** (e.g. `m/86'/0'/0'` for taproot) forces address type when the prefix is ambiguous or wrong for your wallet.

Never paste a seed or xprv.

### Advanced: one address

Paste a Bitcoin address (`bc1q…` / `3…` / `1…`). Scoop converts it to the Electrum
scripthash internally. A 64-hex scripthash still works if you already have one.

### Manual (notes only)

Source **Notes only**: name the wallet, put the xpub in **Notes**, enter approximate
balances. No Electrum sync until you link an xpub or addresses.

## Import validation harness

Throwaway-wallet tests live under `scoop/src/lib/harness/`. They expand an xpub, optionally
**discover** address type against a **mock Electrum ledger**, then assert gap + split-coin
presence (`core_only` / `knots_only` / `both`).

The BIP39 `abandon … about` mnemonic is enough: tests never talk to a live node. Fund
mock addresses with `ledger.fundBoth` / `fundCoreOnly` / `fundKnotsOnly`.

```bash
cd scoop && pnpm test
# or only the harness:
pnpm test:harness
```

| Piece | Role |
|-------|------|
| `throwawayWallets.ts` | Fixtures (start with BIP84 native segwit). Add nested/legacy/taproot mnemonics here. |
| `mockTips.ts` | In-memory Core/Knots balances & history per address |
| `validateImport.ts` | parse → discover → expand → catalog rows |

To add your throwaway wallet: append a fixture with `id`, `scriptKind`, `mnemonic` (or
`extendedKey`), and `accountPath`, then fund addresses on a `MockTipLedger` in a test.

Colors: Core = chocolate brown; Knots = pink; Both = cream (contrast adjusts for light/dark).

## Replay receive vs spill vs core-bound

| Signal | Meaning |
|--------|---------|
| **Replay receive** | Same outpoint **unspent** on Core and Knots — inbound payment replayed; split before spend |
| **Spill** | Same lineage **spent** on both tips — dual-effect spend |
| **Core-bound ok** | Core spent, Knots still unspent — expected after Core-bound ceremony |

Notifications are **in-app only** (on sync / page load). No email or push in v1.

## Status

Organizer schema, dashboard, tasks, and replay-receive detection ship under `scoop/`.
Postgres is required. Open a wallet to see the dual-tip address table.
