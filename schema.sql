CREATE TABLE IF NOT EXISTS fests (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  start TEXT NOT NULL,  -- YYYY-MM-DD, first day of the fest
  end   TEXT NOT NULL   -- YYYY-MM-DD, last day of the fest
);

CREATE TABLE IF NOT EXISTS bookings (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('event','practice')),
  club            TEXT NOT NULL,
  title           TEXT NOT NULL,
  date            TEXT NOT NULL,      -- YYYY-MM-DD
  start_min       INTEGER NOT NULL,   -- minutes after midnight
  end_min         INTEGER NOT NULL,
  items           TEXT NOT NULL,      -- JSON: {"dept-lights":1,"equip-sounds":1}
  fest_id         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  note            TEXT,
  created_by      TEXT NOT NULL,      -- college email
  created_by_name TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  decided_by      TEXT,
  decided_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings (date);
CREATE INDEX IF NOT EXISTS idx_bookings_creator ON bookings (created_by);
