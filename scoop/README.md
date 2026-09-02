# Scoop (Next.js)

Self-hosted read-only Neapolitan coin catalog + organizer UI.

## Unix / macOS (pnpm)

```bash
cp .env.example .env
pnpm install
pnpm run db:migrate   # requires Postgres + SCOOP_DATABASE_URL
pnpm run dev          # http://127.0.0.1:3847
pnpm test
```

## Windows (Docker)

From repo root (binds UI and Postgres to loopback):

```bash
docker compose -f docker-compose.scoop.yml --profile scoop up --build
```

Point `FULCRUM_URL` / `SHULCRUM_URL` at Electrum on the host (defaults use `host.docker.internal`).

See [docs/scoop.md](../docs/scoop.md).
