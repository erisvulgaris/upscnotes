import { Router } from 'express';
import { requireAuth } from '../middleware.js';
import { renderPage } from '../render.js';
import { listBooks, getActiveSubscription, getProgress, getChapters } from '../model.js';

const router = Router();

router.get('/dashboard', requireAuth, (req, res) => {
  const books = listBooks().filter((b) => b.status === 'published');
  const sub = getActiveSubscription(req.session.userId);
  const withProgress = books.map((b) => {
    const prog = getProgress(req.session.userId, b.id);
    const cur = prog ? getChapters(b.id).find((c) => c.number === prog.chapter_number) : null;
    return { ...b, progress: prog, inProgress: cur };
  });
  renderPage(res, 200, 'dashboard', {
    title: 'My library', books: withProgress, sub, paid: req.query.paid === '1',
  });
});

router.get('/checkout', requireAuth, (req, res) => {
  const sub = getActiveSubscription(req.session.userId);
  if (sub) return res.redirect('/dashboard');
  renderPage(res, 200, 'checkout', { title: 'Get lifetime access' });
});

export default router;