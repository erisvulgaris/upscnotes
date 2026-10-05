import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const DB_PATH = path.join(DATA_DIR, 'upscbooks.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user',           -- 'user' | 'admin'
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',              -- path to uploaded cover ('' = placeholder)
      color TEXT NOT NULL DEFAULT '#305496',       -- brand accent for placeholder cover
      status TEXT NOT NULL DEFAULT 'draft',        -- 'draft' | 'published'
      category TEXT NOT NULL DEFAULT 'textbook',   -- 'textbook' | 'ncert'
      chapter_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      sections_json TEXT NOT NULL,                 -- full chapter content JSON
      UNIQUE(book_id, number)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL DEFAULT 'lifetime',
      status TEXT NOT NULL DEFAULT 'active',       -- 'active' | 'lapsed'
      price_paise INTEGER NOT NULL DEFAULT 99900,
      activated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,                             -- NULL = lifetime
      source TEXT NOT NULL DEFAULT 'razorpay',     -- 'razorpay' | 'admin'
      payment_id INTEGER REFERENCES payments(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      razorpay_order_id TEXT UNIQUE,
      razorpay_payment_id TEXT UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount_paise INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',      -- created | authorized | captured | failed
      signature TEXT,
      raw TEXT,
      plan TEXT NOT NULL DEFAULT 'lifetime',       -- lifetime | yearly
      coupon_code TEXT,                             -- consumed on capture
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      chapter_number INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, book_id)
    );

    CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id, number);
    CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
  `);

  // Migration: add category column if missing (for existing databases)
  try {
    db.exec("ALTER TABLE books ADD COLUMN category TEXT NOT NULL DEFAULT 'textbook'");
  } catch (e) {
    // Column already exists — ignore
  }

  // Migration: add subject column for NCERT grouping
  try {
    db.exec("ALTER TABLE books ADD COLUMN subject TEXT NOT NULL DEFAULT ''");
  } catch (e) {
    // Column already exists — ignore
  }
  // Migrations: an order now records the plan and coupon it was created under,
  // so a later price change cannot retroactively alter what was bought.
  addColumnIfMissing('payments', 'plan', "TEXT NOT NULL DEFAULT 'lifetime'");
  addColumnIfMissing('payments', 'coupon_code', 'TEXT');

  // Pricing configuration and coupon codes. Lazily seeded with the values the
  // product shipped with, so switching to yearly or adding a code is a change
  // in the admin rather than a code edit.
  ensurePricingTables();
}

// ALTER TABLE ADD COLUMN throws when the column exists, which is how these
// migrations have always detected the case.
function addColumnIfMissing(table, column, definition) {
  try {
    db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition);
  } catch {
    // already there
  }
}

function ensurePricingTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS coupons (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      code       TEXT NOT NULL UNIQUE,
      kind       TEXT NOT NULL DEFAULT 'flat',
      value      INTEGER NOT NULL,
      max_uses   INTEGER,
      used       INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      note       TEXT,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(active);
  `);
}
