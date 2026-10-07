import { Router } from 'express';
import { renderPage } from '../render.js';
import { getUserByEmail, createUser, verifyPassword } from '../model.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// `next` must be a same-site path, or it becomes an open redirect.
function safeNext(raw, fallback = '/dashboard') {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.includes('\\')) return fallback;
  return v;
}

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  renderPage(res, 200, 'login', {
    title: 'Sign in',
    metaDesc: 'Sign in to open your upscnotes library.',
    error: null,
    next: safeNext(req.query.next, '/dashboard'),
    email: '',
  });
});

router.post('/login', (req, res, next) => {
  const email = (req.body.email || '').trim();
  const password = req.body.password || '';
  const user = getUserByEmail(email);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return renderPage(res, 401, 'login', {
      title: 'Sign in',
      metaDesc: 'Sign in to open your upscnotes library.',
      error: 'That email and password do not match an account.',
      next: safeNext(req.body.next, '/dashboard'),
      email,
    });
  }

  // Regenerate the session id so a pre-login session can't be fixated.
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.role = user.role;
    req.session.name = user.name;
    res.redirect(safeNext(req.body.next, '/dashboard'));
  });
});

router.get('/signup', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  renderPage(res, 200, 'signup', {
    title: 'Create account',
    metaDesc: 'Create a free upscnotes account.',
    error: null,
    email: '',
    name: '',
  });
});

router.post('/signup', (req, res, next) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const name = (req.body.name || '').trim().slice(0, 120);
  const next2 = safeNext(req.body.next, '/checkout');

  const fail = (error, code = 422) =>
    renderPage(res, code, 'signup', {
      title: 'Create account',
      metaDesc: 'Create a free upscnotes account.',
      error,
      email,
      name,
    });

  if (!EMAIL_RE.test(email)) return fail('Enter a valid email address.');
  if (password.length < 8) return fail('Password must be at least 8 characters.');
  if (getUserByEmail(email)) {
    return fail('An account with this email already exists. Sign in instead.');
  }

  const id = createUser({ email, password, name, role: 'user' });
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = id;
    req.session.email = email;
    req.session.role = 'user';
    req.session.name = name;
    res.redirect(next2);
  });
});

// Signing out changes state, so it is a POST behind the CSRF token. The GET
// stays as a friendly landing page rather than silently logging anyone out.
router.get('/logout', (req, res) => {
  renderPage(res, 200, 'signed-out', {
    title: 'Signed out',
    metaDesc: 'You have been signed out of upscnotes.',
    error: null,
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

export default router;