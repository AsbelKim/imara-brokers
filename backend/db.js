import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir     = path.join(__dirname, 'db');
fs.mkdirSync(dbDir, { recursive: true });

export const db = new Database(path.join(dbDir, 'imara.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8');
db.exec(schema);

// ── Helpers ───────────────────────────────────────────────────────────────
function cols(table)  { return db.pragma(`table_info(${table})`).map(c => c.name); }
function addCol(table, col, def) {
  if (!cols(table).includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

// ── kyc_documents: drop old CHECK constraint + add doc_subtype ────────────
// SQLite can't ALTER a constraint, so we recreate the table if it still has
// the old hard-coded doc_type CHECK.
const kycSql = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='kyc_documents'"
).get()?.sql ?? '';

if (kycSql.includes('national_id_front')) {
  db.exec(`
    BEGIN;
    ALTER TABLE kyc_documents RENAME TO _kyc_old;
    CREATE TABLE kyc_documents (
      id          TEXT PRIMARY KEY,
      trader_id   TEXT NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
      doc_type    TEXT NOT NULL,
      doc_subtype TEXT,
      file_path   TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      reviewed_at TEXT,
      notes       TEXT,
      UNIQUE (trader_id, doc_type)
    );
    CREATE INDEX IF NOT EXISTS idx_kyc_trader ON kyc_documents(trader_id);
    INSERT INTO kyc_documents (id, trader_id, doc_type, file_path, status, uploaded_at, reviewed_at, notes)
    SELECT id, trader_id, doc_type, file_path, status, uploaded_at, reviewed_at, notes
    FROM _kyc_old;
    DROP TABLE _kyc_old;
    COMMIT;
  `);
} else {
  // table already recreated — just ensure doc_subtype column exists
  addCol('kyc_documents', 'doc_subtype', 'TEXT');
}

// ── traders: new columns ──────────────────────────────────────────────────
addCol('traders', 'kyc_status',          "TEXT NOT NULL DEFAULT 'not_started'");
addCol('traders', 'agreement_signed_at', 'TEXT');

// ── challenges: widen plan CHECK to include free_trial ────────────────────
const chSql = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='challenges'"
).get()?.sql ?? '';

if (chSql.includes("'starter','standard','advanced','elite','pro'") && !chSql.includes('free_trial')) {
  db.exec(`
    BEGIN;
    ALTER TABLE challenges RENAME TO _challenges_v1;
    CREATE TABLE challenges (
      id             TEXT PRIMARY KEY,
      trader_id      TEXT NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
      plan           TEXT NOT NULL,
      account_size   INTEGER NOT NULL,
      fee            INTEGER NOT NULL,
      profit_split   INTEGER NOT NULL,
      phase          INTEGER NOT NULL DEFAULT 1,
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
    INSERT INTO challenges
      SELECT id,trader_id,plan,account_size,fee,profit_split,phase,status,
             profit_usd,daily_loss_usd,drawdown_usd,trading_days,start_date,created_at
      FROM _challenges_v1;
    DROP TABLE _challenges_v1;
    COMMIT;
  `);
}

// ── challenges: FTMO-rule columns ─────────────────────────────────────────
addCol('challenges', 'profit_target_usd',    'REAL');
addCol('challenges', 'daily_loss_limit_usd', 'REAL');
addCol('challenges', 'max_drawdown_usd',     'REAL');
addCol('challenges', 'min_trading_days',     'INTEGER DEFAULT 4');
addCol('challenges', 'max_calendar_days',    'INTEGER');
addCol('challenges', 'deadline',             'TEXT');
addCol('challenges', 'initial_balance',      'REAL');
addCol('challenges', 'current_balance',      'REAL');
addCol('challenges', 'mt5_login',            'TEXT');
addCol('challenges', 'mt5_password',         'TEXT');
addCol('challenges', 'mt5_server',           'TEXT');
addCol('challenges', 'parent_challenge_id',  'TEXT');
addCol('challenges', 'funded_at',            'TEXT');
addCol('challenges', 'agreement_signed_at',  'TEXT');
addCol('challenges', 'violated_rule',        'TEXT');
addCol('challenges', 'scale_count',          'INTEGER DEFAULT 0');

// ── payouts: new columns ──────────────────────────────────────────────────
// Widen accepted payment methods — recreate table if old CHECK still present
const payoutSql = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='payouts'"
).get()?.sql ?? '';

if (payoutSql.includes("'mpesa','bank'")) {
  db.exec(`
    BEGIN;
    ALTER TABLE payouts RENAME TO _payouts_old;
    CREATE TABLE payouts (
      id              TEXT PRIMARY KEY,
      trader_id       TEXT NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
      challenge_id    TEXT NOT NULL REFERENCES challenges(id),
      amount_usd      REAL NOT NULL,
      method          TEXT NOT NULL,
      account_details TEXT NOT NULL,
      account_name    TEXT,
      payment_method_id TEXT,
      notes           TEXT,
      fee_refunded    INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','paid','rejected')),
      requested_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      processed_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_payouts_trader ON payouts(trader_id);
    INSERT INTO payouts (id, trader_id, challenge_id, amount_usd, method,
                         account_details, account_name, status, requested_at, processed_at)
    SELECT id, trader_id, challenge_id, amount_usd, method,
           account_details, account_name, status, requested_at, processed_at
    FROM _payouts_old;
    DROP TABLE _payouts_old;
    COMMIT;
  `);
} else {
  addCol('payouts', 'payment_method_id', 'TEXT');
  addCol('payouts', 'notes',             'TEXT');
  addCol('payouts', 'fee_refunded',      'INTEGER NOT NULL DEFAULT 0');
}

export const now = () => new Date().toISOString();
