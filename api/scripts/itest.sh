#!/usr/bin/env bash
# npm run itest: create a throwaway Neon branch, migrate it, run the admin/employee flows, delete it.
set -euo pipefail
N() { neonctl --config-dir "$HOME/attendance-app/.neon-cli" "$@" </dev/null; }
P=patient-frog-20926084
N branches delete itest --project-id $P >/dev/null 2>&1 || true
N branches create --project-id $P --name itest >/dev/null
trap 'N branches delete itest --project-id $P >/dev/null 2>&1 && echo "test branch deleted"' EXIT
URL=$(N connection-string itest --project-id $P --pooled | tr -d '\n')
export NODE_ENV=test DATABASE_URL="$URL" ITEST_OK=1
npx tsx --env-file=.env src/db/migrate.ts
npx tsx --env-file=.env scripts/admin-itest.ts 2>&1 | grep -vE '^(<--|-->)'
