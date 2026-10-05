import { randomBytes, timingSafeEqual } from 'node:crypto';

// Lightweight per-session CSRF token. Non-cookie origin attacks can't read the
// token from the session, so a constant-time compare keeps state-changing
// requests (admin actions, payments) tied to a real session.
export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

export function newCsrfToken() {
  return randomBytes(24).toString('hex');
}

export function attachCsrf(req, res, next) {
  if (!req.session) return next();
  if (!req.session.csrf) req.session.csrf = newCsrfToken();
  res.locals.csrf = req.session.csrf;
  next();
}

// Drop-in protection for all state-changing requests. Reads the token from the
// `_csrf` form field or the `x-csrf-token` header and compares it to the
// session token (constant-time).
export function csrfProtect(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const expected = req.session?.csrf;
  // Multipart bodies are not parsed yet when this runs, so the token arrives in
  // the query string instead of a form field. Accepted only for that content
  // type, which keeps the fallback narrow.
  const isMultipart = String(req.headers['content-type'] || '').startsWith('multipart/form-data');
  const supplied = String(
    req.body?._csrf ||
    req.headers['x-csrf-token'] ||
    (isMultipart ? req.query?._csrf : '') ||
    ''
  );
  if (!expected || !supplied) return res.status(403).send('CSRF token missing');
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(403).send('CSRF token invalid');
  }
  next();
}