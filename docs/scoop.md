# Scoop

Optional **read-only** dual-tip wallet UI for Neapolitan (`neop`). Catalogs which coins exist on
**Core**, **Knots**, or **both**; shows movement per tip; surfaces likely **Spills** and
**replay receives**; organizes wallet locations and split to-dos on a self-hosted dashboard.

Scoop does **not** sign, broadcast, or speak Electrum to wallets. It watches Fulcrum (`:15001`) and
Shulcrum (`:15011`) and stores results in local Postgres.

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
| `SCOOP_DATABASE_URL` | Postgres (required for dashboard / accounts / tasks / notifications) |
| `FULCRUM_URL` | Core Electrum (Fulcrum) |
| `SHULCRUM_URL` | Knots Electrum (Shulcrum) |
| `SCOOP_BIND` | Host/port for the Next server |

## Modes

| Mode | Purpose |
|------|---------|
| Dashboard | Portfolio totals, account cards, replay alerts |
| Accounts | Manual or Electrum-linked wallet locations |
| Tasks | Manual + auto split / spill / replay to-dos |
| Neapolitan / Flavor / Spills | Coin catalog under `/catalog` |

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
Postgres is required for organizer features; ephemeral scripthash sync still works for catalog-only use.
