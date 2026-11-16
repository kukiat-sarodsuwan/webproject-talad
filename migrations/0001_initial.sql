CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'cashier')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE UNIQUE INDEX single_owner ON users(role) WHERE role = 'owner';

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires INTEGER NOT NULL
);
CREATE INDEX session_expiry ON sessions(expires);

CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  bucket INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE INDEX login_attempts_bucket ON login_attempts(bucket);

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  promptpay TEXT NOT NULL DEFAULT '',
  paper INTEGER NOT NULL DEFAULT 80 CHECK (paper IN (58, 80))
);
INSERT INTO settings (id, name) VALUES (1, 'ร้านของฉัน');

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
INSERT INTO categories (name) VALUES ('อาหาร'), ('ขนมหวาน'), ('เครื่องดื่ม'), ('สินค้าอื่น ๆ');

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  sku TEXT NOT NULL COLLATE NOCASE UNIQUE,
  barcode TEXT COLLATE NOCASE UNIQUE,
  unit TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price BETWEEN 0 AND 99999999),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock INTEGER NOT NULL CHECK (low_stock >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE INDEX products_category ON products(category_id);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  cashier TEXT NOT NULL,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  method TEXT NOT NULL CHECK (method IN ('cash', 'promptpay')),
  paid INTEGER NOT NULL CHECK (paid >= 0),
  total INTEGER NOT NULL CHECK (total >= 0 AND paid >= total),
  payment_reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'void')),
  void_reason TEXT,
  void_by INTEGER REFERENCES users(id),
  void_at TEXT,
  cart TEXT NOT NULL,
  shop TEXT NOT NULL
);
CREATE INDEX sales_created ON sales(created, id);

CREATE TABLE sale_items (
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  unit TEXT NOT NULL,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (sale_id, product_id)
);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  sale_id INTEGER REFERENCES sales(id),
  request_id TEXT UNIQUE,
  quantity INTEGER NOT NULL CHECK (quantity <> 0),
  reason TEXT NOT NULL,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX movements_product ON stock_movements(product_id, id);
CREATE UNIQUE INDEX movement_sale ON stock_movements(sale_id, product_id, reason) WHERE sale_id IS NOT NULL;

CREATE TRIGGER apply_movement AFTER INSERT ON stock_movements
BEGIN
  UPDATE products SET stock = stock + NEW.quantity WHERE id = NEW.product_id;
END;

CREATE TRIGGER complete_sale AFTER INSERT ON sales
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.cart) AS item
    LEFT JOIN products AS p ON p.id = json_extract(item.value, '$.id')
    WHERE p.id IS NULL OR p.active <> 1
      OR p.price <> json_extract(item.value, '$.price')
      OR p.stock < json_extract(item.value, '$.quantity')
  ) THEN RAISE(ABORT, 'CART_CHANGED') END;

  INSERT INTO sale_items (sale_id, product_id, name, sku, unit, price, quantity)
    SELECT NEW.id, p.id, p.name, p.sku, p.unit, p.price, json_extract(item.value, '$.quantity')
    FROM json_each(NEW.cart) AS item JOIN products AS p ON p.id = json_extract(item.value, '$.id');

  INSERT INTO stock_movements (product_id, user_id, sale_id, quantity, reason)
    SELECT product_id, NEW.user_id, NEW.id, -quantity, 'sale' FROM sale_items WHERE sale_id = NEW.id;
END;

CREATE TRIGGER reverse_sale AFTER UPDATE OF status ON sales
WHEN OLD.status = 'paid' AND NEW.status = 'void'
BEGIN
  INSERT INTO stock_movements (product_id, user_id, sale_id, quantity, reason)
    SELECT product_id, NEW.void_by, NEW.id, quantity, 'void' FROM sale_items WHERE sale_id = NEW.id;
END;
