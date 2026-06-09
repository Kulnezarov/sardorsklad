-- Порядок и состав полей товара для витрины (склад + CHPARTS)
ALTER TABLE products ADD COLUMN IF NOT EXISTS display_layout JSONB;
