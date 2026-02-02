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

load_env_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "Error: env file not found: $file" >&2
    exit 1
  fi

  # shellcheck disable=SC2162
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ""|\#*) continue ;;
    esac

    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      local key="${line%%=*}"
      local val="${line#*=}"

      # Strip optional surrounding quotes
      if [[ "$val" =~ ^\".*\"$ ]]; then
        val="${val:1:${#val}-2}"
      elif [[ "$val" =~ ^\'.*\'$ ]]; then
        val="${val:1:${#val}-2}"
      fi

      export "$key=$val"
    fi
  done <"$file"
}

ENV_FILES=()
COMPOSE_ENV_ARGS=()

while [ "${1:-}" != "" ]; do
  case "$1" in
    --env-file)
      shift
      if [ "${1:-}" = "" ]; then
        echo "Error: --env-file requires a path" >&2
        exit 1
      fi
      ENV_FILES+=("$1")
      COMPOSE_ENV_ARGS+=(--env-file "$1")
      shift
      ;;
    *)
      echo "Error: unknown argument: $1" >&2
      echo "Usage: ./scripts/up-prod.sh [--env-file <path>]..." >&2
      exit 1
      ;;
  esac
done

# If no --env-file provided, try .env in repo root (common for self-hosting).
if [ "${#ENV_FILES[@]}" -eq 0 ] && [ -f ".env" ]; then
  ENV_FILES+=(".env")
  COMPOSE_ENV_ARGS+=(--env-file ".env")
fi

for f in "${ENV_FILES[@]}"; do
  load_env_file "$f"
done

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Error: missing required environment variable: $name" >&2
    exit 1
  fi
}

require_env NEXTAUTH_SECRET
require_env INTERNAL_API_SECRET
require_env DATABASE_URL

# Production compose assumes S3-compatible storage is enabled.
require_env S3_BUCKET
require_env S3_REGION

if [ -z "${S3_ACCESS_KEY_ID:-}" ] || [ -z "${S3_SECRET_ACCESS_KEY:-}" ]; then
  echo "Warning: S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY not set." >&2
  echo "         If you rely on static credentials (MinIO / non-IRSA setups), please set them." >&2
fi

if [ -z "${NEXT_PUBLIC_WS_URL:-}" ]; then
  echo "Warning: NEXT_PUBLIC_WS_URL is not set. Clients may not be able to connect to WebSocket." >&2
fi

echo "Starting Litewrite (prod) via docker compose..."
echo
echo "Using compose file: docker-compose.prod.yml"
if [ "${#ENV_FILES[@]}" -gt 0 ]; then
  echo "Loaded env files:"
  for f in "${ENV_FILES[@]}"; do
    echo "  - $f"
  done
fi
echo

docker compose -f docker-compose.prod.yml "${COMPOSE_ENV_ARGS[@]}" up -d --build

echo
echo "Started. Useful commands:"
echo "  docker compose -f docker-compose.prod.yml ${COMPOSE_ENV_ARGS[*]} ps"
echo "  docker compose -f docker-compose.prod.yml ${COMPOSE_ENV_ARGS[*]} logs -f web"
echo
echo "Health checks:"
echo "  - App:            http://localhost:3000"
echo "  - AI Server:      http://localhost:6612/health/live"
echo "  - Compile Server: http://localhost:3002/health"
