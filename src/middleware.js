import { getActiveSubscription, listBooks } from './model.js';
import { renderPage } from './render.js';

// Computed once at boot — the subject list only changes when a book is
// imported, and it feeds the header menu, the drawer and the landing index.
const SUBJECT_ORDER = [
  'History', 'Political Science', 'Geography', 'Economics',
  'Environment', 'Social Science', 'Psychology',
];

let subjectNavCache = null;

export function subjectNav() {
  if (subjectNavCache) return subjectNavCache;
  const counts = new Map();
  for (const b of listBooks()) {
    if (b.status !== 'published') continue;
    const key = (b.subject || '').trim() || 'Others';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const ordered = [...counts.keys()].sort((a, b) => {
    const ia = SUBJECT_ORDER.indexOf(a);
    const ib = SUBJECT_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
  subjectNavCache = ordered.map((subject) => ({
    subject,
    count: counts.get(subject),
    anchor: subject.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  }));
  return subjectNavCache;
}

export function requireAuth(req, res, next) {
  if (!req.session.userId) {
    const target = encodeURIComponent(req.originalUrl);
    return res.redirect('/login?next=' + target);
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.role !== 'admin') {
    return renderPage(res, 403, '403', { title: 'Forbidden' });
  }
  next();
}

export function requireSubscription(req, res, next) {
  const sub = getActiveSubscription(req.session.userId);
  if (!sub) {
    return renderPage(res, 403, 'locked', {
      title: 'Membership required',
      book: req.book,
    });
  }
  req.subscription = sub;
  next();
}

// For layout: tells templates whether the current user has an active sub.
export function attachViewLocals(req, res, next) {
  res.locals.user = req.session.userId
    ? { id: req.session.userId, email: req.session.email, name: req.session.name, role: req.session.role }
    : null;
  res.locals.isAdmin = req.session.role === 'admin';
  res.locals.path = req.path;
  res.locals.subjectsNav = subjectNav();
  if (req.session.userId) {
    res.locals.hasSub = !!getActiveSubscription(req.session.userId);
  } else {
    res.locals.hasSub = false;
  }
  next();
}
