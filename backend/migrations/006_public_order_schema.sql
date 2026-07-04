-- Public website orders require these columns in reserves/reserve_items.
-- Safe to run multiple times: every change uses IF NOT EXISTS.

ALTER TABLE reserves
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS cancellation_reason_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS cancellation_comment TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_reserves_source ON reserves (source);
CREATE INDEX IF NOT EXISTS idx_reserves_cancellation_reason_code ON reserves (cancellation_reason_code);
CREATE INDEX IF NOT EXISTS idx_reserves_cancelled_by_user_id ON reserves (cancelled_by_user_id);

UPDATE reserves
SET total_amount = total_amount_kzt
WHERE total_amount IS NULL;

ALTER TABLE reserve_items
  ADD COLUMN IF NOT EXISTS quantity INTEGER,
  ADD COLUMN IF NOT EXISTS sale_price_snapshot NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS line_total NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS line_status VARCHAR(20) NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_reserve_items_line_status ON reserve_items (line_status);

UPDATE reserve_items
SET quantity = quantity_ordered
WHERE quantity IS NULL;

UPDATE reserve_items
SET sale_price_snapshot = price_kzt
WHERE sale_price_snapshot IS NULL;

UPDATE reserve_items
SET line_total = COALESCE(price_kzt, 0) * COALESCE(quantity, quantity_ordered, 0)
WHERE line_total IS NULL;
