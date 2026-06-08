-- ============================================================
-- Imara Logic Funded — SQLite Database Schema
-- Applied automatically on server start by backend/db.js
-- ============================================================

PRAGMA foreign_keys = ON;

-- 1. TRADERS
CREATE TABLE IF NOT EXISTS traders (
  id             TEXT PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  phone          TEXT,
  country        TEXT,
  preferred_plan TEXT,
  experience     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 2. CHALLENGES
CREATE TABLE IF NOT EXISTS challenges (
  id             TEXT PRIMARY KEY,
  trader_id      TEXT NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  plan           TEXT NOT NULL,
  account_size   INTEGER NOT NULL,
  fee            INTEGER NOT NULL,
  profit_split   INTEGER NOT NULL,
  phase          INTEGER NOT NULL DEFAULT 1 CHECK (phase IN (1, 2, 3)),
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','passed','failed','funded')),
  profit_usd     REAL DEFAULT 0,
  daily_loss_usd REAL DEFAULT 0,
  drawdown_usd   REAL DEFAULT 0,
  trading_days   INTEGER DEFAULT 0,
  start_date     TEXT NOT NULL DEFAULT (date('now')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_challenges_trader ON challenges(trader_id);

-- 3. PAYOUTS
CREATE TABLE IF NOT EXISTS payouts (
  id              TEXT PRIMARY KEY,
  trader_id       TEXT NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  challenge_id    TEXT NOT NULL REFERENCES challenges(id),
  amount_usd      REAL NOT NULL,
  method          TEXT NOT NULL CHECK (method IN ('mpesa','bank')),
  account_details TEXT NOT NULL,
  account_name    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','paid','rejected')),
  requested_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_payouts_trader ON payouts(trader_id);

-- 4. KYC DOCUMENTS
CREATE TABLE IF NOT EXISTS kyc_documents (
  id          TEXT PRIMARY KEY,
  trader_id   TEXT NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL
                CHECK (doc_type IN ('national_id_front','national_id_back','selfie','bank_statement','utility_bill')),
  file_path   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','under_review','approved','rejected')),
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  notes       TEXT,
  UNIQUE (trader_id, doc_type)
);

CREATE INDEX IF NOT EXISTS idx_kyc_trader ON kyc_documents(trader_id);

-- 5. PAYMENT METHODS  (saved payout destinations)
CREATE TABLE IF NOT EXISTS payment_methods (
  id         TEXT PRIMARY KEY,
  trader_id  TEXT NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,     -- mpesa | bank_transfer | crypto | skrill
  label      TEXT NOT NULL,     -- e.g. "My Equity Bank Account"
  details    TEXT NOT NULL,     -- JSON blob
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_pm_trader ON payment_methods(trader_id);
