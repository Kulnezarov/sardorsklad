# SkladPro - Deployment Guide

This guide covers different deployment options for SkladPro inventory management system.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Database Setup](#database-setup)
4. [Deployment Options](#deployment-options)
5. [Production Configuration](#production-configuration)
6. [Monitoring and Maintenance](#monitoring-and-maintenance)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

- Node.js 18+ 
- Python 3.11+
- PostgreSQL 15+ (или контейнер из `docker-compose.vps.yml`)
- Docker & Docker Compose (recommended)
- Nginx (for production)
- SSL certificate (for HTTPS)

## Environment Setup

### 1. PostgreSQL

На VPS: `docker compose -f docker-compose.vps.yml up -d` поднимает PostgreSQL и применяет `postgres_schema.sql` при первом старте (volume пустой).

Локально: `docker compose up -d postgresql` или свой инстанс + `DATABASE_URL` в `backend/.env`.

### 2. Configure Environment Variables

См. `backend/.env.example` и `frontend/.env.example`. Обязательно: `DATABASE_URL`, `SECRET_KEY`, `ORIGINS`, для фронта — `VITE_API_URL`.

### 3. Database Setup

Схема применяется автоматически из `postgres_schema.sql` при инициализации контейнера Postgres. Дополнительные колонки подтягивает `ensure_schema_updates()` в бэкенде.

## Deployment Options

### Option 1: Docker Compose (Recommended)

#### docker-compose.yml
```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - SECRET_KEY=${SECRET_KEY}
      - ORIGINS=${ORIGINS}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  frontend:
    build: ./frontend
    ports:
      - "80:80"
    restart: unless-stopped
    depends_on:
      - backend

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    restart: unless-stopped
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

#### Deployment Commands
```bash
# Clone repository
git clone https://github.com/your-username/skladpro.git
cd skladpro

# Set up environment variables
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Edit both .env files with your values

# Deploy
docker-compose up -d

# Check status
docker-compose ps
docker-compose logs -f
```

### Option 2: Manual Deployment

#### Backend Deployment
```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the application
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

#### Frontend Deployment
```bash
cd frontend

# Install dependencies
npm install

# Build for production
npm run build

# Serve with nginx (or your preferred web server)
sudo cp -r dist/* /var/www/html/
```

### Option 3: Cloud Deployment

#### Vercel (Frontend) + Railway/Render (Backend)

**Frontend on Vercel:**
1. Connect GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy automatically on push to main branch

**Backend on Railway:**
1. Connect GitHub repository to Railway
2. Set environment variables
3. Railway will build and deploy the Docker container

## Production Configuration

### Nginx Configuration

Create `/etc/nginx/sites-available/skladpro`:

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /path/to/ssl/cert.pem;
    ssl_certificate_key /path/to/ssl/key.pem;

    # Frontend
    location / {
        root /var/www/html;
        try_files $uri $uri/ /index.html;
        
        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### SSL Certificate Setup

#### Using Let's Encrypt (Recommended)
```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d yourdomain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### Systemd Service Files

#### Backend Service (`/etc/systemd/system/skladpro-backend.service`)
```ini
[Unit]
Description=SkladPro Backend
After=network.target

[Service]
Type=exec
User=www-data
Group=www-data
WorkingDirectory=/opt/skladpro/backend
Environment=PATH=/opt/skladpro/backend/venv/bin
ExecStart=/opt/skladpro/backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
Restart=always

[Install]
WantedBy=multi-user.target
```

#### Enable Services
```bash
sudo systemctl enable skladpro-backend
sudo systemctl start skladpro-backend
sudo systemctl status skladpro-backend
```

## Monitoring and Maintenance

### Health Checks

Add these endpoints to your monitoring:

- Backend: `GET /health`
- Frontend: `GET /` (should return 200)

### Log Management

#### Backend Logs
```bash
# View logs
sudo journalctl -u skladpro-backend -f

# Log rotation
sudo nano /etc/logrotate.d/skladpro
```

#### Nginx Logs
```bash
# Access logs
sudo tail -f /var/log/nginx/access.log

# Error logs
sudo tail -f /var/log/nginx/error.log
```

### Database Maintenance

#### Regular Backups
```bash
# Create backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump $DATABASE_URL > backup_$DATE.sql

# Set up cron job
0 2 * * * /path/to/backup-script.sh
```

#### Performance Monitoring
- Monitor query performance (pg_stat_statements, логи)
- Check slow queries regularly
- Optimize indexes if needed

### Security Updates

#### Regular Updates
```bash
# Update system packages
sudo apt update && sudo apt upgrade

# Update Python dependencies
pip install --upgrade -r requirements.txt

# Update Node.js dependencies
npm update
```

#### Security Scans
```bash
# Scan for vulnerabilities
npm audit
pip-audit
```

## Troubleshooting

### Common Issues

#### Database Connection Issues
```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1;"

# Check network connectivity
nc -zv your-postgres-host 5432
```

#### API Not Responding
```bash
# Check if backend is running
curl http://localhost:8000/health

# Check logs
sudo journalctl -u skladpro-backend -n 50
```

#### Frontend Build Issues
```bash
# Clear cache
rm -rf node_modules package-lock.json
npm install

# Check build
npm run build
```

#### Memory Issues
```bash
# Monitor memory usage
free -h
htop

# Check for memory leaks in Python
pip install memory-profiler
python -m memory_profiler main.py
```

### Performance Optimization

#### Database Optimization
```sql
-- Analyze table statistics
ANALYZE products;

-- Rebuild indexes
REINDEX INDEX CONCURRENTLY idx_products_barcode;

-- Check query plan
EXPLAIN ANALYZE SELECT * FROM products WHERE barcode = '123456789';
```

#### Backend Optimization
```python
# Add connection pooling
DATABASE_POOL_SIZE = 20
DB_MAX_OVERFLOW = 40

# Enable query logging
SQL_ECHO = false  # Set to true for debugging
```

#### Frontend Optimization
```javascript
// Enable code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'));

// Optimize bundle size
// vite.config.js
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
});
```

## Scaling

### Horizontal Scaling

#### Load Balancer Setup
```nginx
upstream backend {
    server localhost:8000;
    server localhost:8001;
    server localhost:8002;
}

server {
    location /api/ {
        proxy_pass http://backend;
    }
}
```

#### Docker Scaling
```bash
# Scale backend services
docker-compose up -d --scale backend=3
```

### Database Scaling

#### Read Replicas
- При необходимости — read replicas PostgreSQL
- Update application to use read replicas for read operations
- Implement connection pooling

## Backup and Recovery

### Automated Backups

#### Full Backup Script
```bash
#!/bin/bash
BACKUP_DIR="/opt/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# Database backup
pg_dump $DATABASE_URL > $BACKUP_DIR/db_$DATE.sql

# Application files backup
tar -czf $BACKUP_DIR/app_$DATE.tar.gz /opt/skladpro

# Upload to cloud storage (optional)
# aws s3 cp $BACKUP_DIR/db_$DATE.sql s3://your-backup-bucket/
```

#### Recovery Process
```bash
# Restore database
psql $DATABASE_URL < backup_20231201_120000.sql

# Restore application files
tar -xzf backup_20231201_120000.tar.gz -C /
```

## Security Best Practices

1. **Environment Variables**: Never commit secrets to Git
2. **Regular Updates**: Keep dependencies updated
3. **Access Control**: Use strong passwords and 2FA
4. **Firewall**: Configure UFW or similar
5. **SSL**: Always use HTTPS in production
6. **Monitoring**: Set up alerts for suspicious activity
7. **Backups**: Test restore procedures regularly

## Support

For deployment issues:
1. Check logs for error messages
2. Verify environment variables
3. Test database connectivity
4. Review this troubleshooting guide
5. Create GitHub issue with details

---

Happy deploying! 🚀
