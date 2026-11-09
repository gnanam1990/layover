CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL,
  json TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_trip ON sessions (tripId);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL,
  bookingId TEXT,
  idemKey TEXT UNIQUE,
  amountMinor TEXT NOT NULL,
  currency TEXT NOT NULL,
  tx TEXT,
  network TEXT,
  atUtc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_trip ON payments (tripId);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  bookingId TEXT NOT NULL,
  amountMinor TEXT NOT NULL,
  tx TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  atUtc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rebooks (
  idemKey TEXT PRIMARY KEY,
  tripId TEXT NOT NULL,
  state TEXT NOT NULL,
  json TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rights_assessments (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL,
  flightId TEXT NOT NULL,
  json TEXT NOT NULL,
  atUtc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL,
  json TEXT NOT NULL,
  atUtc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tripId TEXT NOT NULL,
  atUtc TEXT NOT NULL,
  type TEXT NOT NULL,
  simulated INTEGER NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  data TEXT,
  links TEXT
);
CREATE INDEX IF NOT EXISTS events_trip ON events (tripId, seq);

-- No prompt text and no personal data here: step, model, timing and outcome only.
CREATE TABLE IF NOT EXISTS serv_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step TEXT NOT NULL,
  model TEXT NOT NULL,
  tools TEXT NOT NULL,
  latencyMs INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  errorClass TEXT,
  atUtc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
