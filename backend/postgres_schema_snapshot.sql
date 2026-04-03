
CREATE TABLE dashboard_stats (
	id SERIAL NOT NULL, 
	stat_date DATE NOT NULL, 
	total_products INTEGER, 
	low_stock_count INTEGER, 
	stale_stock_count INTEGER, 
	total_sales_today NUMERIC(12, 2), 
	total_sales_mtd NUMERIC(12, 2), 
	sales_count_today INTEGER, 
	pending_reserves INTEGER, 
	in_stock_reserves INTEGER, 
	warehouse_value NUMERIC(14, 2), 
	updated_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id)
)

;


CREATE TABLE notifications (
	id SERIAL NOT NULL, 
	notification_type VARCHAR(50) NOT NULL, 
	title VARCHAR(255) NOT NULL, 
	message TEXT NOT NULL, 
	severity VARCHAR(20) NOT NULL, 
	reference_type VARCHAR(50), 
	reference_id INTEGER, 
	is_read BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	read_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id)
)

;


CREATE TABLE products (
	id SERIAL NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	sku VARCHAR(100) NOT NULL, 
	barcode VARCHAR(50), 
	category VARCHAR(100), 
	brand VARCHAR(100), 
	description TEXT, 
	purchase_price NUMERIC(10, 2) NOT NULL, 
	sale_price NUMERIC(10, 2) NOT NULL, 
	cny_price NUMERIC(10, 2), 
	delivery_cost_kzt NUMERIC(10, 2), 
	profit_percent NUMERIC(5, 2) GENERATED ALWAYS AS ((CASE WHEN purchase_price IS NULL OR purchase_price = 0 THEN NULL ELSE ROUND((((sale_price - purchase_price) / purchase_price) * 100)::numeric, 2) END)) STORED, 
	quantity INTEGER NOT NULL, 
	min_quantity INTEGER, 
	max_quantity INTEGER, 
	location_row VARCHAR(10), 
	location_shelf VARCHAR(10), 
	location_position VARCHAR(10), 
	location_zone VARCHAR(50), 
	supplier VARCHAR(255), 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE, 
	last_sale_date TIMESTAMP WITH TIME ZONE, 
	is_active BOOLEAN NOT NULL, 
	PRIMARY KEY (id)
)

;


CREATE TABLE reserves (
	id SERIAL NOT NULL, 
	order_code VARCHAR(50) NOT NULL, 
	customer_name VARCHAR(255) NOT NULL, 
	customer_phone VARCHAR(20), 
	status VARCHAR(20) NOT NULL, 
	total_amount_cny NUMERIC(12, 2) NOT NULL, 
	total_amount_kzt NUMERIC(12, 2) NOT NULL, 
	cny_rate FLOAT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	expected_arrival TIMESTAMP WITH TIME ZONE, 
	completed_at TIMESTAMP WITH TIME ZONE, 
	notes TEXT, 
	PRIMARY KEY (id)
)

;


CREATE TABLE revision_sessions (
	id SERIAL NOT NULL, 
	session_code VARCHAR(50) NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	notes TEXT, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	completed_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id)
)

;


CREATE TABLE sales (
	id SERIAL NOT NULL, 
	receipt_number VARCHAR(50) NOT NULL, 
	total_amount NUMERIC(10, 2) NOT NULL, 
	payment_method VARCHAR(20), 
	customer_info JSONB, 
	notes TEXT, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id)
)

;


CREATE TABLE settings (
	id SERIAL NOT NULL, 
	store_name VARCHAR(255) NOT NULL, 
	scan_auto_increment BOOLEAN NOT NULL, 
	history_auto_clean_days INTEGER NOT NULL, 
	label_size VARCHAR(20) NOT NULL, 
	dark_mode BOOLEAN NOT NULL, 
	cny_rate NUMERIC(10, 2) NOT NULL, 
	low_stock_threshold INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT single_settings CHECK (id = 1), 
	CONSTRAINT positive_low_stock CHECK (low_stock_threshold > 0)
)

;


CREATE TABLE wish_items (
	id SERIAL NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	brand VARCHAR(100), 
	category VARCHAR(100), 
	notes TEXT, 
	photo_data TEXT, 
	status VARCHAR(20) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id)
)

;


CREATE TABLE history (
	id SERIAL NOT NULL, 
	product_id INTEGER, 
	operation_type VARCHAR(50) NOT NULL, 
	quantity_change INTEGER, 
	reference_type VARCHAR(20), 
	reference_id INTEGER, 
	details JSONB, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE SET NULL
)

;


CREATE TABLE purchase_orders (
	id SERIAL NOT NULL, 
	wish_item_id INTEGER, 
	name VARCHAR(255) NOT NULL, 
	brand VARCHAR(100), 
	category VARCHAR(100), 
	photo_data TEXT, yes
	barcode VARCHAR(50), 
	supplier VARCHAR(255), 
	price_cny NUMERIC(10, 2), 
	price_kzt NUMERIC(10, 2), 
	cny_rate FLOAT, 
	quantity_ordered INTEGER NOT NULL, 
	quantity_received INTEGER NOT NULL, 
	notes TEXT, 
	status VARCHAR(20) NOT NULL, 
	ordered_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	completed_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(wish_item_id) REFERENCES wish_items (id) ON DELETE SET NULL
)

;


CREATE TABLE reserve_items (
	id SERIAL NOT NULL, 
	reserve_id INTEGER NOT NULL, 
	product_id INTEGER, 
	product_name VARCHAR(255) NOT NULL, 
	quantity_ordered INTEGER NOT NULL, 
	quantity_received INTEGER NOT NULL, 
	price_cny NUMERIC(10, 2) NOT NULL, 
	price_kzt NUMERIC(10, 2) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(reserve_id) REFERENCES reserves (id) ON DELETE CASCADE, 
	FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE SET NULL
)

;


CREATE TABLE revision_items (
	id SERIAL NOT NULL, 
	session_id INTEGER NOT NULL, 
	product_id INTEGER NOT NULL, 
	quantity_expected INTEGER NOT NULL, 
	quantity_actual INTEGER, 
	discrepancy INTEGER, 
	is_corrected BOOLEAN NOT NULL, 
	correction_notes TEXT, 
	PRIMARY KEY (id), 
	FOREIGN KEY(session_id) REFERENCES revision_sessions (id) ON DELETE CASCADE, 
	FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE CASCADE
)

;


CREATE TABLE sale_items (
	id SERIAL NOT NULL, 
	sale_id INTEGER NOT NULL, 
	product_id INTEGER, 
	quantity INTEGER NOT NULL, 
	unit_price NUMERIC(10, 2) NOT NULL, 
	subtotal NUMERIC(10, 2) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(sale_id) REFERENCES sales (id) ON DELETE CASCADE, 
	FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE SET NULL
)

;

CREATE UNIQUE INDEX ix_dashboard_stats_stat_date ON dashboard_stats (stat_date);

CREATE INDEX idx_dashboard_stats_stat_date ON dashboard_stats (stat_date);

CREATE INDEX ix_dashboard_stats_id ON dashboard_stats (id);

CREATE INDEX idx_notifications_reference ON notifications (reference_type, reference_id);

CREATE INDEX ix_notifications_is_read ON notifications (is_read);

CREATE INDEX idx_notifications_is_read ON notifications (is_read);

CREATE INDEX idx_notifications_created_at ON notifications (created_at);

CREATE INDEX ix_notifications_id ON notifications (id);

CREATE INDEX ix_notifications_notification_type ON notifications (notification_type);

CREATE INDEX idx_notifications_type ON notifications (notification_type);

CREATE INDEX idx_products_is_active ON products (is_active);

CREATE INDEX ix_products_name ON products (name);

CREATE UNIQUE INDEX ix_products_barcode ON products (barcode);

CREATE UNIQUE INDEX ix_products_sku ON products (sku);

CREATE INDEX ix_products_id ON products (id);

CREATE INDEX ix_products_brand ON products (brand);

CREATE INDEX idx_products_category ON products (category);

CREATE INDEX idx_products_created_at ON products (created_at);

CREATE INDEX ix_products_category ON products (category);

CREATE UNIQUE INDEX ix_reserves_order_code ON reserves (order_code);

CREATE INDEX ix_reserves_status ON reserves (status);

CREATE INDEX idx_reserves_status ON reserves (status);

CREATE INDEX ix_reserves_id ON reserves (id);

CREATE INDEX idx_reserves_created_at ON reserves (created_at);

CREATE INDEX idx_reserves_customer_name ON reserves (customer_name);

CREATE INDEX idx_revision_sessions_created_at ON revision_sessions (created_at);

CREATE INDEX ix_revision_sessions_id ON revision_sessions (id);

CREATE UNIQUE INDEX ix_revision_sessions_session_code ON revision_sessions (session_code);

CREATE INDEX idx_revision_sessions_status ON revision_sessions (status);

CREATE INDEX idx_sales_receipt_number ON sales (receipt_number);

CREATE UNIQUE INDEX ix_sales_receipt_number ON sales (receipt_number);

CREATE INDEX idx_sales_created_at ON sales (created_at);

CREATE INDEX ix_sales_id ON sales (id);

CREATE INDEX ix_settings_id ON settings (id);

CREATE INDEX ix_wish_items_status ON wish_items (status);

CREATE INDEX idx_wish_items_status ON wish_items (status);

CREATE INDEX ix_wish_items_id ON wish_items (id);

CREATE INDEX idx_wish_items_created_at ON wish_items (created_at);

CREATE INDEX idx_history_product_id ON history (product_id);

CREATE INDEX idx_history_operation_type ON history (operation_type);

CREATE INDEX idx_history_created_at ON history (created_at);

CREATE INDEX ix_history_operation_type ON history (operation_type);

CREATE INDEX idx_history_reference ON history (reference_type, reference_id);

CREATE INDEX ix_history_id ON history (id);

CREATE INDEX idx_purchase_orders_ordered_at ON purchase_orders (ordered_at);

CREATE INDEX idx_purchase_orders_wish_item ON purchase_orders (wish_item_id);

CREATE INDEX ix_purchase_orders_status ON purchase_orders (status);

CREATE INDEX idx_purchase_orders_status ON purchase_orders (status);

CREATE INDEX ix_purchase_orders_id ON purchase_orders (id);

CREATE INDEX ix_reserve_items_id ON reserve_items (id);

CREATE INDEX idx_reserve_items_product_id ON reserve_items (product_id);

CREATE INDEX idx_reserve_items_reserve_id ON reserve_items (reserve_id);

CREATE INDEX idx_revision_items_product_id ON revision_items (product_id);

CREATE INDEX idx_revision_items_session_id ON revision_items (session_id);

CREATE INDEX ix_revision_items_id ON revision_items (id);

CREATE INDEX idx_sale_items_product_id ON sale_items (product_id);

CREATE INDEX idx_sale_items_sale_id ON sale_items (sale_id);

CREATE INDEX ix_sale_items_id ON sale_items (id);
