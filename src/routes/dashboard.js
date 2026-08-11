import { Router } from 'express';
import { requireAuth } from '../middleware.js';
import { renderPage } from '../render.js';
import { listBooks, getActiveSubscription, getProgress, getChapters } from '../model.js';

const router = Router();

// Preferred ordering for the library sections; anything else falls to the end.
const SUBJECT_ORDER = ['History', 'Political Science', 'Geography', 'Economics', 'Environment', 'Social Science', 'Psychology'];
const SUBJECT_ALIAS = { Economy: 'Economics' };

function subjectKey(book) {
  const raw = (book.subject || '').trim();
  if (!raw) return 'Others';
  return SUBJECT_ALIAS[raw] || raw;
}

router.get('/dashboard', requireAuth, (req, res) => {
  const books = listBooks().filter((b) => b.status === 'published');
  const sub = getActiveSubscription(req.session.userId);
  const withProgress = books.map((b) => {
    const prog = getProgress(req.session.userId, b.id);
    const cur = prog ? getChapters(b.id).find((c) => c.number === prog.chapter_number) : null;
    return { ...b, subject: subjectKey(b), progress: prog, inProgress: cur };
  });

  const buckets = new Map();
  for (const b of withProgress) {
    if (!buckets.has(b.subject)) buckets.set(b.subject, []);
    buckets.get(b.subject).push(b);
  }
  const order = [...SUBJECT_ORDER, ...[...buckets.keys()].filter((s) => !SUBJECT_ORDER.includes(s))];
  const groups = order
    .filter((s) => buckets.get(s) && buckets.get(s).length)
    .map((s) => ({ subject: s, books: buckets.get(s) }));

  renderPage(res, 200, 'dashboard', {
    title: 'My library', groups, books: withProgress, sub, paid: req.query.paid === '1',
  });
});

router.get('/checkout', requireAuth, (req, res) => {
  const sub = getActiveSubscription(req.session.userId);
  if (sub) return res.redirect('/dashboard');
  const books = listBooks().filter((b) => b.status === 'published');
  const totalBooks = books.length;
  const totalChapters = books.reduce((s, b) => s + (b.chapter_count || 0), 0);
  renderPage(res, 200, 'checkout', { title: 'Get lifetime access', totalBooks, totalChapters });
});

export default router;