-- Резерв: привязка wish_items и purchase_orders к справочнику категорий
ALTER TABLE wish_items ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wish_items_category_id ON wish_items (category_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_category_id ON purchase_orders (category_id);

-- Backfill по совпадению имени подкатегории (только leaf-категории с parent_id)
UPDATE wish_items w
SET category_id = c.id
FROM categories c
WHERE w.category_id IS NULL
  AND w.category IS NOT NULL
  AND TRIM(w.category) <> ''
  AND c.name = TRIM(w.category)
  AND c.parent_id IS NOT NULL
  AND c.is_active = TRUE;

UPDATE purchase_orders p
SET category_id = c.id
FROM categories c
WHERE p.category_id IS NULL
  AND p.category IS NOT NULL
  AND TRIM(p.category) <> ''
  AND c.name = TRIM(p.category)
  AND c.parent_id IS NOT NULL
  AND c.is_active = TRUE;
