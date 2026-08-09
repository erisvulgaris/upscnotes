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
export function upsertLifetimeSubscription(userId, { source = 'razorpay', price_paise = 29900, payment_id = null } = {}) {
  const existing = db.prepare(
    'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1'
  ).get(userId);
  if (existing && existing.status === 'active') return existing;
  const r = db.prepare(
    `INSERT INTO subscriptions (user_id, plan, status, price_paise, activated_at, expires_at, source, payment_id) VALUES (?, 'lifetime', 'active', ?, datetime('now'), NULL, ?, ?)`
  ).run(userId, price_paise, source, payment_id);
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(r.lastInsertRowid);
}
export function getActiveSubscription(userId) {
  return db.prepare(
    `SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'
     AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY id DESC LIMIT 1`
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
export function createPayment({ razorpay_order_id, user_id, amount_paise }) {
  const r = db.prepare(
    'INSERT INTO payments (razorpay_order_id, user_id, amount_paise, status) VALUES (?, ?, ?, ?)'
  ).run(razorpay_order_id, user_id, amount_paise, 'created');
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
export const getBookBySlug = (slug) =>
  db.prepare('SELECT * FROM books WHERE slug = ?').get(slug);
export const getBookById = (id) =>
  db.prepare('SELECT * FROM books WHERE id = ?').get(id);
export function upsertBook({ slug, title, author, description, cover, color }) {
  const existing = getBookBySlug(slug);
  if (existing) {
    db.prepare(
      'UPDATE books SET title = ?, author = ?, description = ?, cover = ?, color = ?, chapter_count = ? WHERE slug = ?'
    ).run(title, author, description, cover, color, 0, slug);
    return getBookBySlug(slug);
  }
  const r = db.prepare(
    'INSERT INTO books (slug, title, author, description, cover, color, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(slug, title, author, description, cover, color, 'published');
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
export function setProgress(userId, bookId, chapterNumber) {
  db.prepare(
    `INSERT INTO reading_progress (user_id, book_id, chapter_number, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, book_id) DO UPDATE SET
       chapter_number = excluded.chapter_number,
       updated_at = excluded.updated_at`
  ).run(userId, bookId, chapterNumber);
}
export const getProgress = (userId, bookId) =>
  db.prepare(
    'SELECT chapter_number, updated_at FROM reading_progress WHERE user_id = ? AND book_id = ?'
  ).get(userId, bookId);

// ---- chapter content search ----
// Titles first (cheap, exact-ish), then full-text over the raw sections JSON.
// LIMIT keeps huge books responsive without an index.
export function searchChapters(bookId, query, limit = 20) {
  const like = `%${query}%`;
  const out = [];
  const titles = db.prepare(
    'SELECT number, title FROM chapters WHERE book_id = ? AND title LIKE ? ORDER BY number ASC LIMIT ?'
  ).all(bookId, like, 5);
  const seen = new Set();
  for (const t of titles) { seen.add(t.number); out.push({ number: t.number, title: t.title, snippet: null }); }
  const body = db.prepare(
    'SELECT number, title, sections_json FROM chapters WHERE book_id = ? AND sections_json LIKE ? ORDER BY number ASC LIMIT ?'
  ).all(bookId, like, limit);
  for (const ch of body) {
    if (seen.has(ch.number)) continue;
    seen.add(ch.number);
    out.push({ number: ch.number, title: ch.title, snippet: makeSnippet(ch.sections_json, query) });
  }
  return out.slice(0, limit);
}

function makeSnippet(json, query) {
  const idx = json.toLowerCase().indexOf(query.toLowerCase());
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