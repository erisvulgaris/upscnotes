import { Router } from 'express';
import { getBookBySlug, getChapter, getChapters, setProgress } from '../model.js';
import { renderChapter, sentenceCount } from '../content.js';
import { requireAuth, requireSubscription } from '../middleware.js';
import { renderPage } from '../render.js';

const router = Router();

// Server-rendered chapter page (gated).
router.get('/:slug/:num', requireAuth, requireSubscriptionForBook, renderChapterPage);
router.get('/:slug', requireAuth, requireSubscriptionForBook, chapterEntry);

// Auth gate that also loads book + attaches ctx. Falls back to a locked stub
// when the subscription check hasn't run with a chapter (e.g. /read/:slug).
async function requireSubscriptionForBook(req, res, next) {
  const { slug } = req.params;
  req.book = getBookBySlug(slug);
  if (!req.book) return renderPage(res, 404, '404', { title: 'Book not found' });
  const { getActiveSubscription } = await import('../model.js');
  if (!getActiveSubscription(req.session.userId)) {
    return renderPage(res, 403, 'locked', { title: 'Membership required', book: req.book });
  }
  next();
}

function chapterEntry(req, res) {
  const chapters = getChapters(req.book.id);
  const first = chapters[0];
  res.redirect(`/read/${req.book.slug}/${first.number}`);
}

function renderChapterPage(req, res, next) {
  const { slug, num } = req.params;
  const n = parseInt(num, 10);
  const chapters = getChapters(req.book.id);          // {number,title} for nav
  const ch = getChapter(req.book.id, n);              // full row incl. sections_json
  if (!ch) return renderPage(res, 404, '404', { title: 'Chapter not found' });

  let body;
  try {
    body = JSON.parse(ch.sections_json);
  } catch (e) {
    console.error('section parse failed for', slug, n, e.message);
    return renderPage(res, 500, '500', { title: 'Chapter error' });
  }

  const ctx = { book: req.book.slug };
  const html = renderChapter(body, ctx);
  const sentences = sentenceCount(body);
  const prev = chapters.find((c) => c.number === n - 1) || null;
  const nxt = chapters.find((c) => c.number === n + 1) || null;
  setProgress(req.session.userId, req.book.id, n);

  res.render('pages/reader', {
    title: `Ch ${n}: ${ch.title}`,
    book: req.book,
    chapter: { number: n, title: ch.title, next: nxt ? nxt.number : null },
    chapters,
    readerBody: html,
    sentenceCount: sentences,
    prev: prev ? { number: prev.number, title: prev.title } : null,
    next: nxt ? { number: nxt.number, title: nxt.title } : null,
  });
}

// Auth-gated chapter fragment for infinite scroll (returns rendered body HTML).
// Query param `sidBase` lets the server renumber TTS sentence ids so playback
// continues seamlessly across chapters.
router.get('/:slug/:num/fragment', requireAuth, requireSubscriptionForBook, (req, res, next) => {
   const n = parseInt(req.params.num, 10);
   const ch = getChapter(req.book.id, n);                 // full row incl. sections_json
   if (!ch) return res.status(404).send('not found');
   let body;
   try { body = JSON.parse(ch.sections_json); } catch (e) { return next(e); }
  const ctx = { book: req.book.slug };
  let html = renderChapter(body, ctx);
  // Renumber tts-sent ids so they continue after the already-loaded chapter.
  const sidBase = parseInt(req.query.sidBase || '0', 10) || 0;
   html = html.replace(/(\bdata-sid=")(\d+)(")/g, (_m, p1, p2, p3) => p1 + (sidBase + Number(p2)) + p3);
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
});

export default router;
