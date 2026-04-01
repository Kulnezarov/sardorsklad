#!/usr/bin/env bash
# Запускайте только на своей машине: bash scripts/setup-env-interactive.sh
# Секреты никуда не отправляются — только файлы в этом каталоге.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== SkladPro: настройка .env (ввод только у вас локально) ==="
echo ""

read -r -p "Supabase project URL (https://xxxx.supabase.co): " SUPABASE_URL
read -r -s -p "Supabase anon key (JWT, длинная строка): " ANON_KEY
echo ""
read -r -p "Полный DATABASE_URL (pooler, из Dashboard → Database): " DATABASE_URL
read -r -p "VITE_API_URL для локального фронта [http://localhost:8000/api/v1]: " VITE_API_URL
VITE_API_URL="${VITE_API_URL:-http://localhost:8000/api/v1}"

read -r -p "Нужен файл для Docker VPS .env.vps? [y/N]: " WANT_VPS
WANT_VPS="${WANT_VPS:-N}"

if [[ "${WANT_VPS}" =~ ^[yY]$ ]]; then
  read -r -p "APP_DOMAIN (например app.example.com): " APP_DOMAIN
  read -r -p "API_DOMAIN (например api.example.com): " API_DOMAIN
  read -r -p "APP_ORIGIN (https://app.example.com): " APP_ORIGIN
  read -r -p "VITE_API_URL для прод [https://${APP_DOMAIN}/api/v1]: " VITE_API_URL_PROD
  VITE_API_URL_PROD="${VITE_API_URL_PROD:-https://${APP_DOMAIN}/api/v1}"
fi

# --- frontend/.env (Vite читает только отсюда для npm run dev) ---
{
  printf 'VITE_SUPABASE_URL=%s\n' "${SUPABASE_URL}"
  printf 'VITE_SUPABASE_ANON_KEY=%s\n' "${ANON_KEY}"
  printf 'VITE_API_URL=%s\n' "${VITE_API_URL}"
} > frontend/.env
chmod 600 frontend/.env
echo "OK: frontend/.env"

# --- backend: обновить ключевые строки или создать из примера ---
BACKEND_ENV="backend/.env"
BACKEND_EX="backend/.env.example"
if [[ ! -f "${BACKEND_ENV}" ]]; then
  cp "${BACKEND_EX}" "${BACKEND_ENV}"
  echo "Создан ${BACKEND_ENV} из примера."
fi

export _BACKEND_ENV="${BACKEND_ENV}"
export _SETUP_SUPABASE_URL="${SUPABASE_URL}"
export _SETUP_ANON_KEY="${ANON_KEY}"
export _SETUP_DATABASE_URL="${DATABASE_URL}"
python3 <<'PY'
import os
import pathlib
import re

path = pathlib.Path(os.environ["_BACKEND_ENV"])
text = path.read_text(encoding="utf-8")


def set_var(name: str, value: str) -> None:
    global text
    pat = re.compile(rf"^{re.escape(name)}=.*$", re.MULTILINE)
    line = f"{name}={value}"
    if pat.search(text):
        text = pat.sub(line, text, count=1)
    else:
        if text and not text.endswith("\n"):
            text += "\n"
        text += line + "\n"


set_var("SUPABASE_URL", os.environ["_SETUP_SUPABASE_URL"])
set_var("SUPABASE_KEY", os.environ["_SETUP_ANON_KEY"])
set_var("SUPABASE_DB_URL", os.environ["_SETUP_DATABASE_URL"])
set_var("DATABASE_URL", os.environ["_SETUP_DATABASE_URL"])
path.write_text(text, encoding="utf-8")
PY
chmod 600 "${BACKEND_ENV}" 2>/dev/null || true
echo "OK: ${BACKEND_ENV} (обновлены SUPABASE_*, DATABASE_URL)"

if [[ "${WANT_VPS}" =~ ^[yY]$ ]]; then
  {
    printf 'APP_DOMAIN=%s\n' "${APP_DOMAIN}"
    printf 'API_DOMAIN=%s\n' "${API_DOMAIN}"
    printf 'APP_ORIGIN=%s\n' "${APP_ORIGIN}"
    printf 'VITE_API_URL=%s\n' "${VITE_API_URL_PROD}"
    printf 'VITE_SUPABASE_URL=%s\n' "${SUPABASE_URL}"
    printf 'VITE_SUPABASE_ANON_KEY=%s\n' "${ANON_KEY}"
  } > .env.vps
  chmod 600 .env.vps
  echo "OK: .env.vps (для docker compose --env-file .env.vps)"
fi

echo ""
echo "Дальше:"
echo "  Локально:  cd frontend && npm run dev"
echo "  Docker:    docker compose --env-file .env.vps -f docker-compose.vps.yml build --no-cache frontend && docker compose --env-file .env.vps -f docker-compose.vps.yml up -d"
echo ""
