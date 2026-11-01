#!/bin/sh
set -e
if [ -n "${SCOOP_DATABASE_URL:-}" ]; then
  npm run db:migrate
fi
exec npx next start -H 0.0.0.0 -p 3847
