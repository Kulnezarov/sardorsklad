# SkladPro - Smart Inventory Management System

A comprehensive web-based inventory management system built with FastAPI, React, and PostgreSQL (Supabase).

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
- **Authentication**: Supabase-based authentication with RLS security
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
├── supabase_schema.sql  # Complete database schema
├── docker-compose.yml   # Docker deployment
└── README.md
```

## Tech Stack

### Backend
- FastAPI 0.104.1
- SQLAlchemy 2.0.23
- PostgreSQL / Supabase
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
- PostgreSQL with Supabase
- RLS (Row-Level Security)
- Custom triggers and views
- Generated columns for calculations
- Database indexes for performance

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.11+
- Supabase account
- Git

### 1. Create Supabase Project
1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Run the SQL schema from `supabase_schema.sql` in the SQL Editor

### 2. Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Copy and configure environment
cp .env.example .env
# Edit .env with your Supabase credentials

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
# Edit .env with your Supabase and API URLs

# Start development server
npm run dev
```

The application will be available at `http://localhost:5173`

## Environment Variables

### Backend (.env)
```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_DB_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres

# Security
SECRET_KEY=your-secret-key-here-change-this-in-production
ALLOWED_ORIGINS=http://localhost:5173,https://yourdomain.com

# Optional: Redis for caching
REDIS_URL=redis://localhost:6379
CACHE_ENABLED=true

# API Configuration
API_HOST=0.0.0.0
API_PORT=8000
ENVIRONMENT=development
```

### Frontend (.env)
```bash
# API Configuration
VITE_API_URL=http://localhost:8000/api/v1

# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# App Configuration
VITE_APP_TITLE=SkladPro
VITE_APP_VERSION=1.0.0
```

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
- `POST /products/import-excel` - Import from Excel
- `GET /products/export-excel` - Export to Excel
- `GET /products/stale` - Get stale products (30+ days)
- `GET /products/categories` - Get all categories

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
- **RLS Policies**: All tables protected with authenticated user policies

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
- Supabase-based authentication
- JWT token management
- Protected routes with PrivateRoute component
- Automatic token refresh
- Session persistence

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

### Environment Setup
1. Set up production Supabase project
2. Configure environment variables
3. Set up reverse proxy (nginx)
4. Configure SSL certificates
5. Set up monitoring and logging

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

- **Row-Level Security (RLS)**: All tables protected with RLS policies
- **Authentication**: Supabase Auth with JWT tokens
- **Input Validation**: Pydantic schemas for all inputs
- **CORS**: Configured for safe cross-origin requests
- **Environment Variables**: Sensitive data in .env files
- **SQL Injection Prevention**: SQLAlchemy ORM usage
- **XSS Protection**: React's built-in XSS protection

## Troubleshooting

### Common Issues

**Database Connection Error**
- Check `SUPABASE_DB_URL` in `.env`
- Ensure Supabase project is active
- Verify credentials and network access

**API Not Responding**
- Check API health: `curl http://localhost:8000/health`
- Verify backend logs
- Check `ALLOWED_ORIGINS` configuration

**Frontend Connection Issues**
- Check `VITE_API_URL` in frontend `.env`
- Clear browser cache and localStorage
- Check network tab in DevTools for CORS errors

**Authentication Issues**
- Verify Supabase URL and keys
- Check RLS policies in Supabase
- Ensure user is authenticated

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
