-- Run manually if ensure_schema_updates() did not run (e.g. non-PostgreSQL).
ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_cost_kzt NUMERIC(10, 2);
