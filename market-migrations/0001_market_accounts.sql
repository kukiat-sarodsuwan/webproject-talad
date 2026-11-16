CREATE TABLE tenants (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  shop_slug TEXT UNIQUE,
  created INTEGER NOT NULL,
  CHECK ((status = 'approved') = (shop_slug IS NOT NULL))
);

CREATE TABLE market_sessions (
  token TEXT PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id),
  role TEXT NOT NULL CHECK (role IN ('tenant', 'admin')),
  expires INTEGER NOT NULL,
  CHECK ((role = 'tenant') = (tenant_id IS NOT NULL))
);

CREATE INDEX market_sessions_expiry ON market_sessions(expires);

CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  bucket INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

CREATE INDEX login_attempts_bucket ON login_attempts(bucket);
