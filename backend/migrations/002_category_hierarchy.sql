-- Двухуровневые категории и характеристики товаров (идемпотентно)
ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id INTEGER;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS attribute_schema JSONB;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon VARCHAR(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS attributes JSONB;

CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
