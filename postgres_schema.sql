-- Products table
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  sku VARCHAR(100) UNIQUE NOT NULL,
  category VARCHAR(100),
  quantity INTEGER DEFAULT 0,
  price DECIMAL(10, 2) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Sales table
CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  total_price DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Reserves table
CREATE TABLE IF NOT EXISTS reserves (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  customer_name VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Product history table
CREATE TABLE IF NOT EXISTS product_history (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  quantity_change INTEGER,
  old_value DECIMAL(10, 2),
  new_value DECIMAL(10, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Revisions table
CREATE TABLE IF NOT EXISTS revisions (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  revision_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expected_quantity INTEGER,
  actual_quantity INTEGER,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX idx_sales_product_id ON sales(product_id);
CREATE INDEX idx_sales_created_at ON sales(created_at);
CREATE INDEX idx_reserves_product_id ON reserves(product_id);
CREATE INDEX idx_reserves_created_at ON reserves(created_at);
CREATE INDEX idx_product_history_product_id ON product_history(product_id);
CREATE INDEX idx_product_history_created_at ON product_history(created_at);
CREATE INDEX idx_revisions_product_id ON revisions(product_id);
CREATE INDEX idx_revisions_created_at ON revisions(created_at);

-- Create view for low stock items
CREATE OR REPLACE VIEW low_stock_items AS
SELECT
  id,
  name,
  sku,
  quantity,
  price,
  CASE
    WHEN quantity < 5 THEN 'critical'
    WHEN quantity < 10 THEN 'low'
    ELSE 'ok'
  END as stock_status
FROM products
WHERE quantity < 10
ORDER BY quantity ASC;

-- Create view for sales summary
CREATE OR REPLACE VIEW sales_summary AS
SELECT
  DATE(created_at) as sale_date,
  COUNT(*) as total_sales,
  SUM(quantity) as total_units,
  SUM(total_price) as total_revenue
FROM sales
GROUP BY DATE(created_at)
ORDER BY sale_date DESC;
