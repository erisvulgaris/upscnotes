import { Router } from 'express';
import { requireAuth } from '../middleware.js';
import { renderPage } from '../render.js';
import { listBooks, getActiveSubscription, getProgress, getChapters } from '../model.js';
import { hasContentBundle } from '../content-cache.js';
import { groupBySubject } from './public.js';
import { getPricing } from '../pricing.js';

const router = Router();

router.get('/dashboard', requireAuth, (req, res) => {
  const books = listBooks()
    .filter((b) => b.status === 'published')
    .map((b) => {
      const progress = getProgress(req.session.userId, b.id);
      const inProgress = progress
        ? getChapters(b.id).find((c) => c.number === progress.chapter_number) || null
        : null;
      return { ...b, progress, inProgress, hasExtras: hasContentBundle(b.slug) };
    });

  const groups = groupBySubject(books);
  const sub = getActiveSubscription(req.session.userId);

  renderPage(res, 200, 'dashboard', {
    title: 'My library',
    metaDesc: 'Your UPSCbooks library and reading progress.',
    groups,
    books,
    sub,
    paid: req.query.paid === '1',
  });
});

router.get('/checkout', requireAuth, (req, res) => {
  const sub = getActiveSubscription(req.session.userId);
  if (sub) return res.redirect('/dashboard');
  const books = listBooks().filter((b) => b.status === 'published');
  const totalBooks = books.length;
  const totalChapters = books.reduce((s, b) => s + (b.chapter_count || 0), 0);
  const ncertCount = books.filter((b) => b.category === 'ncert').length;
  renderPage(res, 200, 'checkout', {
    title: 'Get lifetime access',
    metaDesc: 'Lifetime access to the whole UPSCbooks library for a one-time payment.',
    totalBooks,
    totalChapters,
    ncertCount,
    pricing: getPricing(),
  });
});

export default router;