# Scoop (Next.js)

Read-only Neapolitan coin catalog UI.

```bash
cp .env.example .env
npm install
npm run db:migrate   # requires Postgres + SCOOP_DATABASE_URL
npm run dev          # http://127.0.0.1:3847
npm test
```

Docker (from repo root; binds UI to loopback):

```bash
docker compose -f docker-compose.scoop.yml --profile scoop up --build
```

See [docs/scoop.md](../docs/scoop.md).
