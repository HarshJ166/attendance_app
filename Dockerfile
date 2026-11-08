# GeoMark API + face service in one container (Render free plan = one service).
# The face service listens only on 127.0.0.1:8790; the API listens on $PORT (Render sets it).
FROM node:24-trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv curl ca-certificates libglib2.0-0t64 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Face service: Python deps + verified ONNX models (cached unless these files change).
COPY face/requirements.txt face/get-models.sh face/
RUN python3 -m venv face/.venv && face/.venv/bin/pip install --no-cache-dir -r face/requirements.txt
RUN bash face/get-models.sh
COPY face/server.py face/

# API: build TypeScript, then drop dev dependencies.
COPY api/package.json api/package-lock.json api/
RUN cd api && npm ci --no-audit --no-fund
COPY api/tsconfig.json api/
COPY api/src api/src
RUN cd api && npm run build && npm prune --omit=dev

COPY deploy/start.sh ./
ENV NODE_ENV=production
CMD ["bash", "start.sh"]
