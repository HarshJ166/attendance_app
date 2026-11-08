#!/usr/bin/env bash
# Container entry: face service in the background (local only), API in the foreground.
set -euo pipefail
cd /app
HOST=127.0.0.1 PORT=8790 face/.venv/bin/python face/server.py &
exec node api/dist/index.js
