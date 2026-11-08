#!/usr/bin/env bash
# UI check of the admin panel, logged in, with realistic data, touching nothing real:
#   throwaway Neon branch "qa" + QA API on 127.0.0.1:8788 + fake Auth0 inside Playwright.
# Needs the admin dev server on :5173. Screenshots go to $1 (default: qa/out).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/qa/out}"; mkdir -p "$OUT"
N() { neonctl --config-dir "$ROOT/.neon-cli" "$@" </dev/null; }
P=patient-frog-20926084

N branches delete qa --project-id $P >/dev/null 2>&1 || true
N branches create --project-id $P --name qa >/dev/null
cleanup() { kill "${API_PID:-0}" 2>/dev/null || true; N branches delete qa --project-id $P >/dev/null 2>&1 && echo "qa branch deleted"; }
trap cleanup EXIT
URL=$(N connection-string qa --project-id $P --pooled | tr -d '\n')
# Safety: the qa branch has its own endpoint host. Refuse if it matches the main database's host.
MAIN_HOST=$(grep '^DATABASE_URL=' "$ROOT/api/.env" | sed -E 's|.*@([^/]+)/.*|\1|')
QA_HOST=$(printf '%s' "$URL" | sed -E 's|.*@([^/]+)/.*|\1|')
[[ "$URL" == postgresql://* && -n "$QA_HOST" && "$QA_HOST" != "$MAIN_HOST" ]] || { echo "refusing: qa URL is not a separate branch"; exit 1; }

cd "$ROOT/api"
export NODE_ENV=test ITEST_OK=1 DATABASE_URL="$URL"
# Real Auth0 user creation must never happen in QA: blank the service app (env beats --env-file).
export AUTH0_MGMT_CLIENT_ID= AUTH0_MGMT_CLIENT_SECRET=
npx tsx --env-file=.env src/db/migrate.ts >/dev/null
# Start from an empty copy (the branch inherits main's rows).
node --input-type=module -e 'import postgres from "postgres"; const s=postgres(process.env.DATABASE_URL,{onnotice(){}}); await s`truncate checkin_attempts, attendance, user_sites, users, sites restart identity cascade`; await s.end()'
npx tsx --env-file=.env scripts/qa-server.ts > "$OUT/qa-server.log" 2>&1 &
API_PID=$!
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8788/health && break; sleep 0.5; done
node "$ROOT/qa/${QA_SCRIPT:-admin-pages.mjs}" "$OUT"
