import { Router } from 'express';
import { renderPage } from '../render.js';
import { getUserByEmail, createUser, verifyPassword } from '../model.js';

const router = Router();

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  renderPage(res, 200, 'login', { title: 'Sign in', error: null, next: req.query.next || '/' , email: ''});
});

router.post('/login', (req, res, next) => {
  const email = (req.body.email || '').trim();
  const password = req.body.password || '';
  const user = getUserByEmail(email);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return renderPage(res, 401, 'login', { title: 'Sign in', error: 'Invalid email or password.', next: req.body.next || '/', email });
  }

  // Regenerate the session id so a pre-login session can't be fixated.
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.role = user.role;
    req.session.name = user.name;
    res.redirect(req.body.next && req.body.next.startsWith('/') ? req.body.next : '/dashboard');
  });
});

router.get('/signup', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  renderPage(res, 200, 'signup', { title: 'Create account', error: null, email: '', name: '' });
});

router.post('/signup', (req, res, next) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const name = (req.body.name || '').trim();
  const next2 = req.body.next && req.body.next.startsWith('/') ? req.body.next : '/checkout';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return renderPage(res, 422, 'signup', { title: 'Create account', error: 'Enter a valid email address.', email, name });
  }
  if (password.length < 8) {
    return renderPage(res, 422, 'signup', { title: 'Create account', error: 'Password must be at least 8 characters.', email, name });
  }
  if (getUserByEmail(email)) {
    return renderPage(res, 422, 'signup', { title: 'Create account', error: 'An account with this email already exists. Sign in instead.', email, name });
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

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

export default router;