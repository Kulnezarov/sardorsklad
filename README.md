# SkladPro - Smart Inventory Management System

A comprehensive web-based inventory management system built with FastAPI, React, and PostgreSQL.

## Features

- **Product Management**: Track products with barcodes, prices, quantities, and categories
- **Sales Tracking**: Record and monitor sales in real-time with POS interface
- **Reserve Management**: Manage product reserves from suppliers with CNY to KZT conversion
- **Inventory Revision**: Complete inventory audit system with discrepancy tracking
- **History Log**: Complete audit trail of all operations with filtering
- **Smart Dashboard**: Real-time statistics, charts, and notifications
- **Label Printing**: Generate barcode and QR code labels in multiple sizes
- **Cache System**: In-memory caching with TTL for performance
- **Notifications**: System notifications for low stock and stale products
- **Authentication**: JWT login via FastAPI (`/api/v1/auth`)
- **Excel Integration**: Import/export products via Excel files
- **Responsive Design**: Mobile-friendly interface with touch gestures

## Project Structure

```
skladpro/
├── backend/          # FastAPI backend
│   ├── main.py      # Main application
│   ├── models.py    # SQLAlchemy models
│   ├── schemas.py   # Pydantic schemas
│   ├── database.py  # Database configuration
│   ├── routers/     # API endpoints
│   ├── services/    # Business logic & caching
│   └── requirements.txt
├── frontend/        # React + Vite frontend
│   ├── src/
│   │   ├── pages/   # Page components (Dashboard, Warehouse, etc.)
│   │   ├── components/ # Reusable UI components
│   │   ├── auth/    # Authentication components
│   │   ├── api/     # API client modules
│   │   ├── store/   # Zustand state management
│   │   └── utils/   # Utility functions
│   └── vite.config.js
├── postgres_schema.sql  # Initial PostgreSQL schema (Docker init)
├── docker-compose.yml   # Local dev: Postgres, Redis, backend, frontend
├── docker-compose.vps.yml  # Production stack (Postgres + Redis + Caddy)
└── README.md
```

## Tech Stack

### Backend
- FastAPI 0.104.1
- SQLAlchemy 2.0.23
- PostgreSQL
- AsyncPG for async database operations
- APScheduler for background tasks
- Pydantic v2 for data validation
- OpenPyXL for Excel operations

### Frontend
- React 18.2.0
- Vite 5.0.8
- React Router v6
- Zustand for state management
- TanStack Query for server state
- Axios for HTTP requests
- TailwindCSS for styling
- Recharts for charts
- JsBarcode for barcode generation
- QRCode.react for QR codes

### Database
- PostgreSQL (Docker или отдельный сервер)
- SQLAlchemy models + миграции через `ensure_schema_updates`
- Generated columns for calculations
- Database indexes for performance

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.11+
- PostgreSQL 15+ (или только Docker)
- Git

### 1. PostgreSQL
При `docker compose up` база создаётся из `postgres_schema.sql`. Либо поднимите свой Postgres и задайте `DATABASE_URL` в `backend/.env`.

### 2. Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Copy and configure environment
cp .env.example .env
# Edit .env: DATABASE_URL, SECRET_KEY

# Start the server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The API will be available at `http://localhost:8000`
API Documentation: `http://localhost:8000/docs`

### 3. Frontend Setup

```bash
cd frontend
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env: VITE_API_URL (например http://localhost:8000/api/v1)

# Start development server
npm run dev
```

The application will be available at `http://localhost:5173`

## Public API for CHPARTS

Public endpoints (without authorization):

- `GET /api/v1/public/products`
  - Query: `q`, `category_id`, `in_stock`, `limit`, `offset`
  - Returns only safe fields: `id`, `name`, `sale_price`, `quantity`, `category_id`, `image_url`
- `POST /api/v1/public/orders`
  - Payload:
    - `customer_name`
    - `customer_phone`
    - `comment` (optional)
    - `items`: `[{ product_id, quantity }]`
  - Response: `{ ok: true, reserve_id }`
  - Errors:
    - `400` invalid payload
    - `404` product not found
    - `409` not enough stock

Private endpoints (JWT + role `manager`/`admin`):

- `/api/v1/products/*`
- `/api/v1/categories/*`
- `/api/v1/brands/*`
- `/api/v1/orders/*`

### Next.js integration (chparts.kz)

- Set `NEXT_PUBLIC_API_BASE_URL` to backend base, for example `https://sklad.kz`
- Use:
  - `GET ${NEXT_PUBLIC_API_BASE_URL}/api/v1/public/products`
  - `POST ${NEXT_PUBLIC_API_BASE_URL}/api/v1/public/orders`

### Telegram for website orders

Set in backend `.env`:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID` (single id or comma-separated ids)
- `ADMIN_BASE_URL=https://sklad.kz`

When new website order is created:

- it is saved in warehouse orders (`source=website`)
- telegram message is sent to managers
- if Telegram is unavailable, order creation still succeeds and failed notification can be retried via `POST /api/v1/orders/notifications/retry`

## Environment Variables

### Backend (.env)
См. `backend/.env.example`: `DATABASE_URL`, `SECRET_KEY`, `ORIGINS`, `REDIS_URL`.

### Frontend (.env)
См. `frontend/.env.example`: `VITE_API_URL` (или `auto` для того же хоста + порт API).

## Docker Deployment

### Using Docker Compose

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Individual Docker Builds

```bash
# Build backend
cd backend
docker build -t skladpro-backend .

# Build frontend
cd frontend
docker build -t skladpro-frontend .
```

## API Endpoints

### Products
- `GET /products` - List products with search, filters, pagination
- `POST /products` - Create product
- `GET /products/{id}` - Get product details
- `PUT /products/{id}` - Update product
- `DELETE /products/{id}` - Delete product
- `GET /products/barcode/{barcode}` - Find by barcode
- `POST /products/{id}/discount` - Apply discount
- `POST /products/import/excel` - Import from Excel
- `POST /products/import/excel/stream` - Streaming import with progress
- `GET /products/export/excel` - Export to Excel
- `GET /products/stale` - Get stale products (30+ days)
- `GET /products/categories/list` - Get all categories

### Sales
- `GET /sales` - List sales with date filtering
- `POST /sales` - Create sale with multiple items
- `GET /sales/{id}` - Get sale with items
- `DELETE /sales/{id}` - Delete sale
- `DELETE /sales` - Clear all sales
- `GET /sales/today` - Today's sales statistics

### Reserve
- `GET /reserve` - List reserves with status filtering
- `POST /reserve` - Create reserve order
- `PUT /reserve/{id}` - Update reserve
- `POST /reserve/{id}/to-stock` - Move to warehouse
- `POST /reserve/{id}/cancel` - Cancel reserve
- `POST /reserve/{id}/restore` - Restore cancelled reserve
- `DELETE /reserve/{id}` - Delete reserve

### History
- `GET /history` - List history with operation filtering
- `DELETE /history/{id}` - Delete history record
- `DELETE /history` - Clear all history
- `POST /history/cleanup` - Clean old records

### Revision
- `POST /revision/start` - Start new revision session
- `GET /revision/{session_id}` - Get session with items
- `PUT /revision/{session_id}/item/{product_id}` - Update actual quantity
- `POST /revision/{session_id}/complete` - Complete revision

### Settings
- `GET /settings` - Get all settings
- `PUT /settings` - Update settings
- `GET /settings/dashboard` - Get dashboard data
- `GET /settings/cny-rate` - Get current CNY rate

## Database Schema

### Core Tables
- **products**: Main product table with auto-calculated profit margins
- **reserve**: Supplier orders with CNY→KZT conversion
- **sales**: Sales transactions with receipt numbers
- **sale_items**: Individual items in sales with generated subtotals
- **history**: Complete audit trail with JSONB details
- **settings**: Global settings (single row with id=1)
- **revision_sessions**: Inventory audit sessions
- **revision_items**: Items in audit sessions with auto-calculated differences

### Database Features
- **Generated Columns**: profit_percent, subtotal, difference
- **Triggers**: updated_at timestamps
- **Indexes**: barcode, category, name (GIN), created_at, quantity
- **Views**: v_dashboard_stats, v_today_top_sales, v_today_revenue, v_stale_products, v_low_stock
- **Application-level auth**: JWT и проверки в FastAPI

## Key Features

### Dashboard
- Real-time statistics with 15-second polling
- Top 5 sales chart using Recharts
- Low stock and stale product notifications
- Responsive grid layout

### Warehouse Management
- Dual interface: Catalog view and POS (Point of Sale)
- Advanced search with debouncing (300ms)
- Category filtering with horizontal scroll
- Stale product highlighting
- Barcode scanning interface
- Shopping cart with real-time calculations
- Excel import/export functionality

### Label Printing
- Barcode (Code128) and QR code generation
- Three size options: Small (3×2cm), Medium (4×3cm), Large (6×4cm)
- Print preview modal
- Batch printing support
- Custom barcode option

### Authentication
- Логин через API (`/api/v1/auth/login`), токен в `localStorage`
- Защищённые маршруты (`PrivateRoute`)

### Performance
- In-memory caching with TTL (60s for products, 15s for dashboard)
- Database indexes on frequently queried fields
- Pagination for large datasets
- Optimized queries with views
- Background notifications every 30 minutes

## Development

### Running Tests

Backend:
```bash
cd backend
pytest
```

Frontend:
```bash
cd frontend
npm run test
```

### Code Quality

Backend:
```bash
cd backend
black .
isort .
flake8 .
```

Frontend:
```bash
cd frontend
npm run lint
npm run type-check
```

## Production Deployment

### VPS Deployment (Recommended when you want full control)

This repository includes a ready VPS setup:

- `docker-compose.vps.yml`
- `deploy/vps/Caddyfile`
- `deploy/vps/.env.example`

Architecture on one server:

- `postgresql` (данные, volume `postgres_data`)
- `redis` (кэш)
- `frontend` (Nginx static SPA)
- `backend` (FastAPI)
- `caddy` (reverse proxy; по IP часто только HTTP)

#### 1) Choose VPS plan

Minimum for current project:

- 2 vCPU
- 4 GB RAM
- 40+ GB SSD
- Ubuntu 22.04 LTS

If you expect heavier traffic/imports:

- 4 vCPU
- 8 GB RAM

#### 2) Point domains to VPS

Create DNS `A` records:

- `app.yourdomain.com` -> `<VPS_IP>`
- `api.yourdomain.com` -> `<VPS_IP>`

Wait until DNS propagates.

#### 3) Prepare server

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install ca-certificates curl gnupg git
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

#### 4) Upload project and configure env

```bash
git clone https://github.com/Kulnezarov/sardorsklad.git
cd sardorsklad
cp deploy/vps/.env.example .env.vps
```

Edit `.env.vps`:

```bash
APP_DOMAIN=app.yourdomain.com
API_DOMAIN=api.yourdomain.com
APP_ORIGIN=https://app.yourdomain.com
VITE_API_URL=https://app.yourdomain.com/api/v1
```

В `backend/.env`: `SECRET_KEY`. `DATABASE_URL` на VPS задаётся в `docker-compose.vps.yml` (PostgreSQL в том же compose); при необходимости переопределите `POSTGRES_PASSWORD` в `.env` в корне или в переменных окружения хоста.

#### 5) Start production stack

```bash
docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build
docker compose --env-file .env.vps -f docker-compose.vps.yml ps
```

#### 6) Verify

- Frontend: `https://app.yourdomain.com`
- API health: `https://api.yourdomain.com/health`
- API docs: `https://api.yourdomain.com/api/docs`

#### Updates later (fast workflow)

```bash
git pull
docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build
```

#### Logs / restart

```bash
docker compose --env-file .env.vps -f docker-compose.vps.yml logs -f
docker compose --env-file .env.vps -f docker-compose.vps.yml restart
```

### Vercel (frontend) + Railway (backend)

Такой вариант не требует менять код приложения: достаточно переменных окружения и CORS.

1. **Railway (backend)**  
   - В сервисе открой **Settings → Networking / Domains** и скопируй публичный URL, например `https://your-app.up.railway.app`.  
   - База API для этого проекта: `https://your-app.up.railway.app/api/v1`.  
   - В **Variables** задай `ALLOWED_ORIGINS` со списком разрешённых фронтов (через запятую, без пробелов после запятой по желанию):  
     `https://your-project.vercel.app`  
     Если добавишь свой домен — допиши и его.

2. **Vercel (frontend)**  
   - **Settings → Environment Variables** → добавь:  
     - `VITE_API_URL` = `https://your-app.up.railway.app/api/v1`  
   - Сохрани и сделай **Redeploy**, иначе сборка не подхватит переменную.

3. **С телефона**  
   - Открывай обычную ссылку Vercel: `https://your-project.vercel.app` — отдельный «режим для телефона» не нужен, это тот же сайт по HTTPS.

Если данные не грузятся: в DevTools на ПК проверь, что запросы идут на Railway, а не на `localhost`, и что в ответе нет ошибки CORS.

### Environment Setup
1. Поднять PostgreSQL (входит в `docker-compose.vps.yml`)
2. Настроить переменные окружения и `backend/.env`
3. Reverse proxy (Caddy в compose) или nginx
4. SSL при необходимости
5. Мониторинг и бэкапы БД

### Docker Production
```bash
# Build production images
docker-compose -f docker-compose.prod.yml up -d

# Scale if needed
docker-compose -f docker-compose.prod.yml up -d --scale backend=3
```

### Manual Deployment

Backend:
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Frontend:
```bash
cd frontend
npm run build
# Serve dist folder with nginx or similar
```

## Security Features

- **Authentication**: JWT (FastAPI), пароли через bcrypt
- **Input Validation**: Pydantic schemas for all inputs
- **CORS**: Configured for safe cross-origin requests
- **Environment Variables**: Sensitive data in .env files
- **SQL Injection Prevention**: SQLAlchemy ORM usage
- **XSS Protection**: React's built-in XSS protection

## Troubleshooting

### Common Issues

**Database Connection Error**
- Проверьте `DATABASE_URL` и что контейнер `postgresql` healthy (`docker compose ps`)

**API Not Responding**
- Check API health: `curl http://localhost:8000/health`
- Verify backend logs
- Check `ALLOWED_ORIGINS` configuration

**Frontend Connection Issues**
- Check `VITE_API_URL` in frontend `.env`
- Clear browser cache and localStorage
- Check network tab in DevTools for CORS errors

**Excel Import Error 405**
- Usually means backend/proxy does not support `POST /products/import/excel/stream`
- Frontend now falls back automatically to `POST /products/import/excel`
- If you still see 405, verify backend version and reverse-proxy method rules for `POST`

**Authentication Issues**
- Проверьте логин/пароль админа, `SECRET_KEY`, заголовок `Authorization: Bearer …`

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run tests and linting
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
1. Check existing issues on GitHub
2. Create detailed bug reports with environment info
3. Include error messages and reproduction steps
4. Provide screenshots when applicable

---

Made with ❤️ for smart inventory management
