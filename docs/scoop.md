# Scoop

Optional **read-only** dual-tip wallet UI for Neapolitan (`neop`). Catalogs which coins exist on
**Core**, **Knots**, or **both**; shows movement per tip; surfaces likely **Spills** (dual-tip spends).

Scoop does **not** sign, broadcast, or speak Electrum to wallets. It watches Fulcrum (`:15001`) and
Shulcrum (`:15011`) and stores results in Postgres.

## Threat model

- xpubs / descriptors / addresses are sensitive. Default bind: **`127.0.0.1:3847`**.
- Do not expose Scoop on a public interface without auth (v1 has no auth).
- No private keys are stored.

## Env

See [`scoop/.env.example`](../scoop/.env.example):

| Variable | Purpose |
|----------|---------|
| `SCOOP_DATABASE_URL` | Postgres |
| `FULCRUM_URL` | Core Electrum (Fulcrum) |
| `SHULCRUM_URL` | Knots Electrum (Shulcrum) |
| `SCOOP_BIND` | Host/port for the Next server |

## Modes

| Mode | Purpose |
|------|---------|
| Neapolitan | All coins, color-coded |
| Flavor | Filter Core or Knots |
| Spills | Dual-tip spends |

Colors: Core = chocolate brown; Knots = pink; Both = cream (contrast adjusts for light/dark).

## Status

Scaffold ships theme + schema. Sync, full UI, and compose profile land in stacked follow-up PRs.
Enable with compose profile `scoop` when wired.

Related (when present on your branch): wallets (Sparrow / Shrike), Electrum (Fulcrum / Shulcrum), replay wedges.
