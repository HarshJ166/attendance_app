#!/usr/bin/env bash
# Run GeoMark locally: API (:8787) + admin panel (:5173) + Expo for the phone (:8081).
#   ./start.sh            API + admin in the background (logs prefixed), Expo in front (QR code, press r to reload)
#   ./start.sh --no-mobile   just API + admin
#   ./start.sh --headless    everything in the background (no interactive Expo); Ctrl+C stops all
# Ctrl+C stops everything this script started.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-}"
cd "$ROOT"

say() { printf '\033[1;32m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- prerequisites ----------
command -v node >/dev/null || die "Node.js is not installed."
[ -f api/.env ] || die "api/.env is missing (copy api/.env.example and fill in the secrets)."
grep -q '^DATABASE_URL=postgres' api/.env || die "DATABASE_URL in api/.env is empty."
for app in api admin mobile; do
  [ -d "$app/node_modules" ] || { say "Installing $app dependencies (first run)…"; (cd "$app" && npm install --silent); }
done

# ---------- free the ports, but only from earlier GeoMark runs ----------
free_port() {
  local port=$1
  for pid in $(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null); do
    if ps -o command= -p "$pid" | grep -q "$ROOT\|tsx\|vite\|expo"; then
      # double-check the process belongs to this project before stopping it
      if lsof -p "$pid" 2>/dev/null | grep -q "$ROOT"; then
        say "Stopping an earlier GeoMark process on port $port (pid $pid)"
        kill "$pid" 2>/dev/null || true
        continue
      fi
    fi
    die "Port $port is used by another program (pid $pid: $(ps -o comm= -p "$pid")). Close it and try again."
  done
}
free_port 8787; free_port 5173
[ "$MODE" = "--no-mobile" ] || free_port 8081
sleep 1

# ---------- start ----------
# Background apps ignore Ctrl+C in a script, and each spawns helpers (npx → node, tsx watch → node),
# so on exit we stop every app's whole process tree ourselves. (Process groups / `set -m` don't work
# reliably with macOS's bash 3.2 when Expo owns the terminal.)
PIDS=()
tree() { local p=$1 c; for c in $(pgrep -P "$p" 2>/dev/null); do tree "$c"; done; echo "$p"; }
cleanup() {
  trap - INT TERM HUP EXIT
  echo; say "Stopping everything…"
  local all=""; for pid in "${PIDS[@]}"; do all="$all $(tree "$pid")"; done
  kill -TERM $all 2>/dev/null || true
  sleep 1
  kill -KILL $all 2>/dev/null || true
}
trap cleanup INT TERM HUP EXIT   # HUP: the Terminal window was closed

# Each background app gets its own log prefix. Runs in its own folder, so the app's own config is used.
# $! is the app itself (the prefixer runs in a process substitution), so PIDS holds each tree's root.
run() {
  local name=$1 dir=$2; shift 2
  local prefix; prefix="$(printf '\033[2m[%s]\033[0m' "$name")"
  ( cd "$ROOT/$dir" && exec "$@" ) > >(awk -v p="$prefix" '{ print p " " $0; fflush() }') 2>&1 &
  PIDS+=($!)
}

run api api npx tsx watch --env-file=.env src/index.ts
run admin admin npx vite --port 5173 --strictPort

# wait for both to answer
for i in $(seq 1 60); do
  curl -s -o /dev/null http://localhost:8787/health && curl -s -o /dev/null http://localhost:5173 && break
  sleep 0.5
done
curl -s -o /dev/null http://localhost:8787/health || die "The API didn't start. See the [api] lines above."

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "your-mac-ip")
echo
say "API          http://localhost:8787   (phone uses http://$IP:8787)"
say "Admin panel  http://localhost:5173"
if [ "$MODE" = "--no-mobile" ]; then
  say "Mobile skipped (--no-mobile). Ctrl+C to stop."
  wait
elif [ "$MODE" = "--headless" ]; then
  run mobile mobile npx expo start --dev-client --lan
  say "Expo         http://$IP:8081   (open GeoMark on the phone, same Wi-Fi). Ctrl+C to stop."
  wait
else
  say "Expo starting below: open GeoMark on the phone (same Wi-Fi as this Mac) and pick $IP:8081."
  say "Press r in Expo to reload the app, Ctrl+C to stop everything."
  echo
  (cd "$ROOT/mobile" && npx expo start --dev-client --lan) || true  # Ctrl+C ends Expo; the trap stops the rest
fi
