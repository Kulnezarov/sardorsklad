# Публичный API SkladPro (для витрины CHPARTS и бота)

База: `{API_ORIGIN}/api/v1` (пример: `https://домен/api/v1`).

Браузер витрины чаще ходит через Next `rewrite` на тот же origin; **бот и cron** — напрямую к этому `API_ORIGIN`, **не** через `localhost:3000` и не через `/api/proxy/...` витрины.

## Публичные маршруты

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/public/products` | Каталог (`q`, `category_id`, `brand_id`, `model`, `limit`, `offset`, `sort`, `in_stock`, …). Ответ: `{ "items", "total" }`. |
| GET | `/public/products/{id}` | Карточка товара |
| POST | `/public/orders` | Оформление заказа; ответ `{ "ok", "reserve_id" }` (это id резерва) |
| GET | `/public/orders/{reserve_id}` | Статус заказа, query: `phone` (как при оформлении) |
| GET | `/public/reserves/{reserve_id}` | **Позиции заказа** + статусы строк (для «Мои заказы»), query: `phone` |
| GET | `/public/categories` | Категории |
| GET | `/public/brands` | Бренды |

### GET `/public/reserves/{id}?phone=...`

- Те же правила, что и у `/public/orders/{id}`: заказ `source=website`, телефон должен совпадать.
- `items[].line_status`: `pending` | `fulfilled` | `cancelled` (в БД нет статуса по строке — наследуется от заказа).
- Сумма: `total_amount` (тенге, строка с двумя знаками).

### Поля товара для витрины

В `items[]` у `/public/products` есть отдельное поле `model` (модель/серия авто), отдельно от `brand_name` (марка/бренд). Фильтр `model=...` ищет по этой колонке и дополнительно по названию/описанию для совместимости со старыми карточками.

## Защищённые (staff) API

- Заказы в кабинете: `PUT /api/v1/orders/{id}/status` (JWT) — смена статуса, не через публичные пути.

## Переменные окружения (фрагмент)

- `ORIGINS` — CORS для витрины
- `ADMIN_BASE_URL` — ссылки в Telegram для менеджеров
- `TELEGRAM_*` — уведомления о новых заказах (см. `services/telegram_orders.py`)
