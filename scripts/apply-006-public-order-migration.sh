#!/usr/bin/env bash
# Применить миграцию для публичных заказов с сайта (reserves / reserve_items).
# Запуск на VPS из корня репозитория skladpro:
#   bash scripts/apply-006-public-order-migration.sh

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vps.yml}"
MIGRATION="${MIGRATION:-backend/migrations/006_public_order_schema.sql}"

if [[ ! -f "$MIGRATION" ]]; then
  echo "Migration not found: $MIGRATION" >&2
  exit 1
fi

echo "Applying $MIGRATION ..."
docker compose -f "$COMPOSE_FILE" exec -T postgresql psql -U skladpro -d skladpro < "$MIGRATION"
echo "Restarting backend ..."
docker compose -f "$COMPOSE_FILE" restart backend
echo "Done."
