-- Резерв: связь wish/PO со складом, количество, авто-совместимость
ALTER TABLE wish_items ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE wish_items ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1 NOT NULL;
ALTER TABLE wish_items ADD COLUMN IF NOT EXISTS compatibility_vehicle_model_ids JSONB;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wish_items_product_id ON wish_items (product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_product_id ON purchase_orders (product_id);
