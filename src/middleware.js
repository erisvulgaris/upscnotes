import { getActiveSubscription } from './model.js';
import { renderPage } from './render.js';

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
  if (req.session.userId) {
    res.locals.hasSub = !!getActiveSubscription(req.session.userId);
  } else {
    res.locals.hasSub = false;
  }
  next();
}
