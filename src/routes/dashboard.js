import { Router } from 'express';
import { requireAuth } from '../middleware.js';
import { renderPage } from '../render.js';
import { listBooks, getActiveSubscription, getProgress, getChapters } from '../model.js';
import { hasContentBundle } from '../content-cache.js';
import { groupBySubject } from './public.js';
import { getPricing } from '../pricing.js';
import { db } from '../db.js';

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

router.get('/revision', requireAuth, (req, res) => {
  const books = listBooks()
    .filter((b) => b.status === 'published')
    .map((b) => {
      const progress = getProgress(req.session.userId, b.id);
      if (!progress) return null;
      const ch = getChapters(b.id).find((c) => c.number === progress.chapter_number) || null;
      const daysSince = progress.updated_at
        ? Math.max(0, Math.floor((Date.now() - new Date(progress.updated_at).getTime()) / 86400000))
        : 999;
      const due = daysSince >= 3;
      return { ...b, progress, inProgress: ch, daysSince, due, hasExtras: hasContentBundle(b.slug) };
    })
    .filter(Boolean);

  const due = books.filter((b) => b.due);
  const upToDate = books.filter((b) => !b.due);

  renderPage(res, 200, 'revision', {
    title: 'Revision',
    metaDesc: 'Books and chapters that are due for review.',
    due,
    upToDate,
    total: books.length,
  });
});

router.get('/analytics', requireAuth, (req, res) => {
  const books = listBooks().filter((b) => b.status === 'published');
  const progressRows = db.prepare('SELECT book_id, chapter_number, updated_at FROM reading_progress WHERE user_id = ?').all(req.session.userId);
  const progressMap = new Map();
  for (const p of progressRows) {
    if (!progressMap.has(p.book_id)) progressMap.set(p.book_id, []);
    progressMap.get(p.book_id).push(p);
  }
  let chaptersRead = 0;
  let booksStarted = 0;
  let completedBooks = 0;
  let totalMs = 0;
  for (const b of books) {
    const rows = progressMap.get(b.id) || [];
    if (rows.length) booksStarted++;
    const last = rows[rows.length - 1];
    if (last && last.chapter_number >= (b.chapter_count || 0)) completedBooks++;
    chaptersRead += rows.length;
    for (const r of rows) totalMs += Number(r.audio_ms || 0);
  }
  const minutes = Math.round(totalMs / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const timeStr = hours > 0 ? hours + 'h ' + mins + 'm' : mins + 'm';

  renderPage(res, 200, 'analytics', {
    title: 'Analytics',
    metaDesc: 'Your reading progress and stats.',
    stats: {
      totalBooks: books.length,
      booksStarted,
      completedBooks,
      chaptersRead,
      timeStr,
    },
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