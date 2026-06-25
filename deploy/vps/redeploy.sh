#!/usr/bin/env bash
# Пересборка и перезапуск стека на VPS. Запуск из корня репозитория:
#   bash deploy/vps/redeploy.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE=".env.vps"
COMPOSE="docker compose --env-file ${ENV_FILE} -f docker-compose.vps.yml"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Нет ${ENV_FILE} — создайте: cp deploy/vps/.env.example .env.vps"
  exit 1
fi

echo "==> Build & up (backend healthy → caddy)..."
${COMPOSE} build
${COMPOSE} up -d --force-recreate backend frontend caddy

echo "==> Status"
${COMPOSE} ps

echo "==> Backend logs (last 40 lines)"
${COMPOSE} logs backend --tail 40

echo "==> Health via Caddy"
sleep 3
curl -sf "http://127.0.0.1/health" && echo || {
  echo "FAIL: /health — смотрите: ${COMPOSE} logs backend"
  exit 1
}

echo "OK"
