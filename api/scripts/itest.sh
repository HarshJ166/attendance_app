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
export AUTH0_MGMT_CLIENT_ID= AUTH0_MGMT_CLIENT_SECRET=  # never create real Auth0 users from tests
# Face service for the face flow (own port; the shared secret comes from api/.env).
FS=$(grep '^FACE_SECRET=' .env | cut -d= -f2-)
if [ -n "$FS" ] && [ -x ../face/.venv/bin/python ]; then
  (cd ../face && FACE_SECRET="$FS" PORT=8791 .venv/bin/python server.py > /dev/null 2>&1) &
  FACE_PID=$!
  trap 'kill $FACE_PID 2>/dev/null; N branches delete itest --project-id $P >/dev/null 2>&1 && echo "test branch deleted"' EXIT
  export FACE_URL=http://127.0.0.1:8791
  for i in $(seq 1 40); do curl -s -o /dev/null $FACE_URL/health && break; sleep 0.25; done
fi
npx tsx --env-file=.env src/db/migrate.ts
npx tsx --env-file=.env scripts/admin-itest.ts 2>&1 | grep -vE '^(<--|-->)'
