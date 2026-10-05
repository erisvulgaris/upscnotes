// Pricing.
//
// Every price the product shows lives here, backed by the settings table and
// editable from /admin/pricing. The checkout page, the locked page, the
// landing page and the order API all read from this module, so a price change
// in the admin is the only thing needed to change it everywhere - previously
// 999, 1199, 299 and UPSC299 were hard-coded in four different files and
// could disagree with each other.
//
// Amounts are paise (integers) throughout. Floats never touch money.

import { db } from './db.js';

// ----------------------------------------------------------------------------
// settings

const DEFAULTS = {
  // 'lifetime' pays once and never expires; 'yearly' charges per year.
  pricing_mode: 'lifetime',
  price_lifetime: '99900',
  price_yearly: '19900',
  // The struck-through reference price. 0 hides it.
  compare_price: '119900',
  coupons_enabled: '1',
  // Free-form line shown under the price, e.g. "Billed yearly, cancel any time".
  pricing_note: '',
  // Whether a lapsed yearly subscription blocks reading.
  grace_days: '0',
  request_book_email: '',
  request_book_message: '',
};

let cache = null;
let cacheAt = 0;

export function invalidatePricing() {
  cache = null;
}

function readSettings() {
  // settings can change mid-session from the admin; a short TTL keeps reads cheap
  // without making an edit feel delayed.
  if (cache && Date.now() - cacheAt < 15_000) return cache;
  const out = { ...DEFAULTS };
  try {
    for (const row of db.prepare('SELECT key, value FROM settings').all()) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, row.key)) out[row.key] = row.value;
    }
  } catch {
    // No settings table yet: defaults are correct, so seeding can be lazy.
  }
  cache = out;
  cacheAt = Date.now();
  return out;
}

export function getSetting(key) {
  const s = readSettings();
  return Object.prototype.hasOwnProperty.call(DEFAULTS, key) ? s[key] : null;
}

export function setSetting(key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
    throw new Error('unknown setting: ' + key);
  }
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, String(value));
  invalidatePricing();
  return String(value);
}

// ----------------------------------------------------------------------------
// pricing

const paise = (v) => Math.max(0, Math.round(Number(v) || 0));

/** The pricing a visitor should see, resolved and ready to render. */
export function getPricing() {
  const s = readSettings();
  const mode = s.pricing_mode === 'yearly' ? 'yearly' : 'lifetime';
  const amount = paise(mode === 'yearly' ? s.price_yearly : s.price_lifetime);
  const compare = paise(s.compare_price);

  return {
    mode,
    yearly: mode === 'yearly',
    amount,
    amountLabel: rupees(amount),
    // Plain rupee figure for templates that render the ₹ separately.
    rupees: rupeesNumber(amount),
    // Only show a reference price when it is genuinely above the real one.
    compare: compare > amount ? compare : 0,
    compareLabel: compare > amount ? rupees(compare) : '',
    couponsEnabled: s.coupons_enabled === '1',
    note: s.pricing_note || '',
    graceDays: paise(s.grace_days),
    perYear: mode === 'yearly',
    terms: mode === 'yearly'
      ? { cadence: 'per year', duration: '12 months', durationMonths: 12 }
      : { cadence: 'one-time', duration: 'lifetime', durationMonths: 0 },
    featureLine: mode === 'yearly'
      ? 'Billed every 12 months. Cancel any time and keep access to the end of the period.'
      : 'One payment. No renewal date and no per-book charges.',
  };
}

/** The amount as a plain rupee figure, grouped, with no currency symbol —
 *  templates render the ₹ as its own element beside the number. */
export function rupeesNumber(p) {
  const whole = Math.floor(paise(p) / 100);
  const frac = paise(p) % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? grouped + '.' + String(frac).padStart(2, '0') : grouped;
}

/** 99900 -> "₹999". 129900 -> "₹1,299". */
export function rupees(p) {
  const frac = paise(p) % 100;
  return '₹' + rupeesNumber(p) + (frac ? '' : '');
}

// ----------------------------------------------------------------------------
// coupons

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;

export function normaliseCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function listCoupons() {
  try {
    return db.prepare('SELECT * FROM coupons ORDER BY active DESC, created_at DESC').all();
  } catch {
    return [];
  }
}

export function createCoupon({ code, kind, value, maxUses, expiresAt, note }) {
  const clean = normaliseCode(code);
  if (!CODE_RE.test(clean)) {
    throw new Error('Use 3–24 characters: letters, digits, hyphen or underscore.');
  }
  const k = kind === 'percent' ? 'percent' : 'flat';
  const v = Math.round(Number(value));
  if (!Number.isFinite(v) || v <= 0) throw new Error('Enter a value greater than zero.');
  if (k === 'percent' && v > 100) throw new Error('A percentage cannot exceed 100.');
  if (k === 'flat' && v > 10_000_00) throw new Error('That is more than ₹10,000.');

  const existing = db.prepare('SELECT id FROM coupons WHERE code = ?').get(clean);
  if (existing) throw new Error('Code ' + clean + ' already exists.');

  db.prepare(`
    INSERT INTO coupons (code, kind, value, max_uses, expires_at, note, active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(
    clean, k, v,
    maxUses ? Math.max(1, Math.round(Number(maxUses))) : null,
    expiresAt || null,
    (note || '').slice(0, 200) || null
  );
  return db.prepare('SELECT * FROM coupons WHERE code = ?').get(clean);
}

export function setCouponActive(code, active) {
  const info = db.prepare('UPDATE coupons SET active = ? WHERE code = ?')
    .run(active ? 1 : 0, normaliseCode(code));
  if (!info.changes) throw new Error('No such coupon.');
  return db.prepare('SELECT * FROM coupons WHERE code = ?').get(normaliseCode(code));
}

export function deleteCoupon(code) {
  const info = db.prepare('DELETE FROM coupons WHERE code = ?').run(normaliseCode(code));
  if (!info.changes) throw new Error('No such coupon.');
}

/**
 * Validates a code and returns the paise it takes off.
 * Throws with a message that is safe to show a visitor.
 */
export function validateCoupon(code, baseAmountPaise) {
  const clean = normaliseCode(code);
  if (!clean) return { code: '', discount: 0, amount: paise(baseAmountPaise) };

  const s = readSettings();
  if (s.coupons_enabled !== '1') throw new Error('Discount codes are switched off.');

  const c = db.prepare('SELECT * FROM coupons WHERE code = ?').get(clean);
  if (!c) throw new Error('That code is not valid.');
  if (!c.active) throw new Error('That code is no longer available.');
  if (c.expires_at && new Date(c.expires_at + 'T23:59:59Z') < new Date()) {
    throw new Error('That code has expired.');
  }
  if (c.max_uses && c.used >= c.max_uses) throw new Error('That code has been fully used.');

  const base = paise(baseAmountPaise);
  const discount = c.kind === 'percent'
    ? Math.round((base * paise(c.value)) / 100)
    : paise(c.value);

  if (discount >= base) throw new Error('That code does not reduce this price.');
  return { code: clean, discount, amount: base - discount, kind: c.kind };
}

/** Called once a payment is captured, so a limited-use code stops working. */
export function recordCouponUse(code) {
  const clean = normaliseCode(code);
  if (!clean) return;
  try {
    db.prepare('UPDATE coupons SET used = used + 1 WHERE code = ?').run(clean);
  } catch { /* coupons are optional */ }
}

// ----------------------------------------------------------------------------
// seeding

/**
 * Creates the tables and seeds sensible defaults the first time the admin
 * opens pricing. Safe to call on every boot.
 */
export function ensurePricingSchema() {
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

  const count = db.prepare('SELECT COUNT(*) n FROM settings').get().n;
  if (count === 0) {
    const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(DEFAULTS)) ins.run(k, v);
  }
  invalidatePricing();
}