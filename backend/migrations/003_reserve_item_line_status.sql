-- Статус позиции заказа: pending | cancelled | fulfilled
ALTER TABLE reserve_items
  ADD COLUMN IF NOT EXISTS line_status VARCHAR(20) NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_reserve_items_line_status ON reserve_items (line_status);
