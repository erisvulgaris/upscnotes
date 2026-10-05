import { db } from './db.js';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

// ---- password hashing (scrypt, built-in) ----
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---- users ----
export const getUserByEmail = (email) =>
  db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
export const getUserById = (id) =>
  db.prepare('SELECT * FROM users WHERE id = ?').get(id);
export function createUser({ email, password, name, role = 'user' }) {
  const r = db.prepare(
    'INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)'
  ).run(email, hashPassword(password), name, role);
  return r.lastInsertRowid;
}
export const setUserRole = (id, role) =>
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
export const listUsers = () =>
  db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC').all();
export const countUsers = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

// ---- subscriptions ----
/**
 * Grants access. `plan` is 'lifetime' (no expiry) or 'yearly' (expires after
 * `expiresAt`). An existing active subscription is left alone, so re-granting
 * from the admin cannot silently extend a plan someone already paid for.
 */
export function upsertLifetimeSubscription(userId, {
  source = 'razorpay', price_paise = 99900, payment_id = null,
  plan = 'lifetime', expiresAt = null,
} = {}) {
  const existing = db.prepare(
    'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1'
  ).get(userId);
  if (existing && existing.status === 'active') return existing;
  const r = db.prepare(
    `INSERT INTO subscriptions (user_id, plan, status, price_paise, activated_at, expires_at, source, payment_id)
     VALUES (?, ?, 'active', ?, datetime('now'), ?, ?, ?)`
  ).run(userId, plan, price_paise, expiresAt || null, source, payment_id);
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(r.lastInsertRowid);
}
export function getActiveSubscription(userId) {
  // Lifetime must mean lifetime. An expiry date on a lifetime row - left over
  // from an import, or set by mistake - is ignored rather than silently
  // expiring a purchase the member was told never would.
  return db.prepare(
    `SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'
       AND (plan = 'lifetime' OR expires_at IS NULL OR expires_at > datetime('now'))
     ORDER BY id DESC LIMIT 1`
  ).get(userId);
}
export function setSubscriptionStatus(id, status) {
  return db.prepare('UPDATE subscriptions SET status = ? WHERE id = ?').run(status, id);
}
export function activateForUserByAdmin(userId, price_paise = 0) {
  return upsertLifetimeSubscription(userId, { source: 'admin', price_paise });
}
export const countActiveSubs = () =>
  db.prepare(`SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'active'`).get().n;

// ---- payments ----
export function createPayment({
  razorpay_order_id, user_id, amount_paise,
  plan = 'lifetime', coupon_code = null,
}) {
  const r = db.prepare(
    `INSERT INTO payments (razorpay_order_id, user_id, amount_paise, status, plan, coupon_code)
     VALUES (?, ?, ?, 'created', ?, ?)`
  ).run(razorpay_order_id, user_id, amount_paise, plan, coupon_code);
  return r.lastInsertRowid;
}
export const getPaymentByOrder = (orderId) =>
  db.prepare('SELECT * FROM payments WHERE razorpay_order_id = ?').get(orderId);
export function capturePayment({ razorpay_order_id, razorpay_payment_id, signature, raw }) {
  db.prepare(
    `UPDATE payments SET razorpay_payment_id = ?, status = 'captured', signature = ?, raw = ? WHERE razorpay_order_id = ?`
  ).run(razorpay_payment_id, signature, raw, razorpay_order_id);
  return db.prepare('SELECT * FROM payments WHERE razorpay_order_id = ?').get(razorpay_order_id);
}
export const listPayments = () =>
  db.prepare('SELECT * FROM payments ORDER BY created_at DESC').all();
export const sumCaptured = () =>
  db.prepare(`SELECT COALESCE(SUM(amount_paise),0) AS total FROM payments WHERE status = 'captured'`).get().total;

// ---- books ----
export const listBooks = () =>
  db.prepare('SELECT * FROM books ORDER BY created_at DESC').all();
export const listBooksByCategory = (category) =>
  db.prepare('SELECT * FROM books WHERE category = ? ORDER BY title ASC').all(category);
export const getBookBySlug = (slug) =>
  db.prepare('SELECT * FROM books WHERE slug = ?').get(slug);
export const getBookById = (id) =>
  db.prepare('SELECT * FROM books WHERE id = ?').get(id);
export function upsertBook({ slug, title, author, description, cover, color, category, subject }) {
  const existing = getBookBySlug(slug);
  if (existing) {
    db.prepare(
      'UPDATE books SET title = ?, author = ?, description = ?, cover = ?, color = ?, category = ?, subject = ?, chapter_count = ? WHERE slug = ?'
    ).run(title, author, description, cover, color, category || 'textbook', subject || '', 0, slug);
    return getBookBySlug(slug);
  }
  const r = db.prepare(
    'INSERT INTO books (slug, title, author, description, cover, color, status, category, subject) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(slug, title, author, description, cover, color, 'published', category || 'textbook', subject || '');
  return getBookById(r.lastInsertRowid);
}
export function updateBook(slug, fields) {
  for (const [k, v] of Object.entries(fields)) {
    db.prepare(`UPDATE books SET ${k} = ? WHERE slug = ?`).run(v, slug);
  }
  return getBookBySlug(slug);
}
export function setBookChapterCount(slug, n) {
  return db.prepare('UPDATE books SET chapter_count = ? WHERE slug = ?').run(n, slug);
}

// ---- chapters ----
export function replaceChapters(bookId, chapters) {
  const del = db.prepare('DELETE FROM chapters WHERE book_id = ?');
  const ins = db.prepare(
    'INSERT INTO chapters (book_id, number, title, sections_json) VALUES (?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  try {
    del.run(bookId);
    for (const ch of chapters) {
      ins.run(bookId, ch.number, ch.title, JSON.stringify(ch.sections));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export function getChapters(bookId) {
  return db.prepare('SELECT number, title FROM chapters WHERE book_id = ? ORDER BY number ASC').all(bookId);
}
export function getChapter(bookId, number) {
  return db.prepare('SELECT * FROM chapters WHERE book_id = ? AND number = ?').get(bookId, number);
}
export const countChapters = (bookId) =>
  db.prepare('SELECT COUNT(*) AS n FROM chapters WHERE book_id = ?').get(bookId).n;

// ---- reading progress ----
//
// Resuming needs more than the chapter number: a 45-minute narration restarted
// from zero is not a resume. audio_ms and scroll_pct are stored separately so a
// reader who only listened, or only scrolled, still gets back where they were.
const clamp01 = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
};

/**
 * Marks which chapter a reader is in.
 *
 * The stored position is cleared only when the chapter actually changes.
 * Reopening the same chapter must not throw away the position the reader would
 * have been restored to moments earlier.
 */
export function setProgress(userId, bookId, chapterNumber, extra = {}) {
  db.prepare(
    `INSERT INTO reading_progress (user_id, book_id, chapter_number, audio_ms, scroll_pct, completed, updated_at)
     VALUES (?, ?, ?, 0, 0, 0, datetime('now'))
     ON CONFLICT(user_id, book_id) DO UPDATE SET
       audio_ms = CASE WHEN reading_progress.chapter_number = excluded.chapter_number
                       THEN reading_progress.audio_ms ELSE 0 END,
       scroll_pct = CASE WHEN reading_progress.chapter_number = excluded.chapter_number
                         THEN reading_progress.scroll_pct ELSE 0 END,
       completed = CASE WHEN reading_progress.chapter_number = excluded.chapter_number
                        THEN reading_progress.completed ELSE 0 END,
       chapter_number = excluded.chapter_number,
       updated_at = excluded.updated_at`
  ).run(userId, bookId, chapterNumber);
}

/**
 * Records where inside the current chapter the reader is, without touching which
 * chapter that is. Called on a timer while listening or scrolling, so it is kept
 * to a single narrow statement.
 */
export function setReadingPosition(userId, bookId, { audioMs, scrollPct, completed } = {}) {
  db.prepare(
    `UPDATE reading_progress
     SET audio_ms = ?, scroll_pct = ?, completed = ?, updated_at = datetime('now')
     WHERE user_id = ? AND book_id = ?`
  ).run(
    Math.max(0, Math.round(Number(audioMs) || 0)),
    clamp01(scrollPct),
    completed ? 1 : 0,
    userId, bookId
  );
}

export const getProgress = (userId, bookId) =>
  db.prepare(
    `SELECT chapter_number, audio_ms, scroll_pct, completed, updated_at
     FROM reading_progress WHERE user_id = ? AND book_id = ?`
  ).get(userId, bookId);

// ---- bookmarks ----

export function listBookmarks(userId, bookId) {
  return db.prepare(
    `SELECT id, chapter_number, audio_ms, scroll_pct, label, created_at
     FROM bookmarks WHERE user_id = ? AND book_id = ? ORDER BY chapter_number, id`
  ).all(userId, bookId);
}
export function createBookmark(userId, bookId, data) {
  const r = db.prepare(
    `INSERT INTO bookmarks (user_id, book_id, chapter_number, audio_ms, scroll_pct, label)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    userId, bookId,
    Math.max(1, Math.round(Number(data.chapterNumber) || 1)),
    Math.max(0, Math.round(Number(data.audioMs) || 0)),
    clamp01(data.scrollPct),
    String(data.label || '').slice(0, 200)
  );
  return db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(r.lastInsertRowid);
}
// Scoped to the owner so one member cannot delete another's bookmark by guessing
// an id.
export const deleteBookmark = (userId, id) =>
  db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;

// ---- notes ----

export function listNotes(userId, bookId) {
  return db.prepare(
    `SELECT id, chapter_number, body, audio_ms, scroll_pct, created_at, updated_at
     FROM notes WHERE user_id = ? AND book_id = ? ORDER BY chapter_number, id`
  ).all(userId, bookId);
}
export function createNote(userId, bookId, data) {
  const body = String(data.body || '').trim().slice(0, 8000);
  if (!body) throw new Error('A note cannot be empty.');
  const r = db.prepare(
    `INSERT INTO notes (user_id, book_id, chapter_number, body, audio_ms, scroll_pct)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    userId, bookId,
    Math.max(1, Math.round(Number(data.chapterNumber) || 1)),
    body,
    Math.max(0, Math.round(Number(data.audioMs) || 0)),
    clamp01(data.scrollPct)
  );
  return db.prepare('SELECT * FROM notes WHERE id = ?').get(r.lastInsertRowid);
}
export function updateNote(userId, id, body) {
  const text = String(body || '').trim().slice(0, 8000);
  if (!text) throw new Error('A note cannot be empty.');
  return db.prepare(
    `UPDATE notes SET body = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
  ).run(text, id, userId).changes > 0;
}
export const deleteNote = (userId, id) =>
  db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;

// ---- chapter content search ----
// Titles first (cheap, exact-ish), then full-text over the raw sections JSON.
// LIMIT keeps huge books responsive without an index.

// Escape LIKE wildcards so a user typing "%" searches for a literal percent
// sign instead of turning the query into a full table scan.
export function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (c) => '\\' + c);
}

export function searchChapters(bookId, query, limit = 20) {
  const clean = String(query || '').trim();
  if (clean.length < 2) return [];
  const like = `%${escapeLike(clean)}%`;
  const out = [];
  const titles = db.prepare(
    `SELECT number, title FROM chapters
      WHERE book_id = ? AND title LIKE ? ESCAPE '\\'
      ORDER BY number ASC LIMIT ?`
  ).all(bookId, like, 5);
  const seen = new Set();
  for (const t of titles) { seen.add(t.number); out.push({ number: t.number, title: t.title, snippet: null }); }
  const body = db.prepare(
    `SELECT number, title, sections_json FROM chapters
      WHERE book_id = ? AND sections_json LIKE ? ESCAPE '\\'
      ORDER BY number ASC LIMIT ?`
  ).all(bookId, like, limit);
  for (const ch of body) {
    if (seen.has(ch.number)) continue;
    seen.add(ch.number);
    out.push({ number: ch.number, title: ch.title, snippet: makeSnippet(ch.sections_json, clean) });
  }
  return out.slice(0, limit);
}

function makeSnippet(json, query) {
  const idx = json.toLowerCase().indexOf(String(query).toLowerCase());
  if (idx < 0) return null;
  const raw = json.slice(Math.max(0, idx - 80), idx + 140);
  const text = raw
    .replace(/\\n/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\u003c/gi, '[').replace(/\\u003e/gi, ']')
    .replace(/[{}[\]]/g, ' ')
    .replace(/"(?:id|num|title|kind|runs|text|bold|italic)"\s*:/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return text ? '…' + text + '…' : null;
}

export function randomToken(len = 32) {
  return randomBytes(len).toString('hex');
}