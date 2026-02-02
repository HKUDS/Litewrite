#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: missing required command: $1" >&2
    exit 1
  fi
}

require_cmd docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: 'docker compose' is not available. Please install Docker Desktop (or Docker Engine + Compose plugin)." >&2
  exit 1
fi

if [ ! -f "env.example.oss" ]; then
  echo "Error: env.example.oss not found in repo root." >&2
  exit 1
fi

if [ ! -f ".env" ]; then
  cp "env.example.oss" ".env"
  echo "Created .env from env.example.oss"
  echo
  echo "Next: open .env and set at least:"
  echo "  - NEXTAUTH_SECRET"
  echo "  - INTERNAL_API_SECRET"
  echo
  echo "Optional: enable AI features by setting OPENROUTER_API_KEY (and optional EMBEDDING_API_KEY / SERPER_API_KEY)."
  echo
fi

echo "Starting Litewrite (dev) via docker compose..."
echo
echo "URLs:"
echo "  - App:            http://localhost:3000"
echo "  - WS (Yjs):       ws://localhost:1234"
echo "  - AI Server:      http://localhost:6612/health"
echo "  - Compile Server: http://localhost:3002/health"
echo "  - MinIO Console:  http://localhost:9001 (minioadmin/minioadmin)"
echo
echo "Tip: run in background:"
echo "  ./scripts/up-dev.sh -d"
echo

docker compose up "$@"
