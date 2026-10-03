import { Router } from 'express';
import { getBookBySlug, getChapter, getChapters, setProgress, getActiveSubscription } from '../model.js';
import { renderChapter, sentenceCount } from '../content.js';
import { requireAuth } from '../middleware.js';
import { renderPage } from '../render.js';
import { hasAudio } from '../audio.js';

const router = Router();

// Auth + subscription gate. Loads the book, checks access, and renders the
// locked stub rather than redirecting so the reader URL stays shareable.
function gate(req, res, next) {
  const book = getBookBySlug(req.params.slug);
  if (!book || book.status !== 'published') {
    return renderPage(res, 404, '404', { title: 'Book not found', metaDesc: 'Book not found.' });
  }
  req.book = book;
  if (!getActiveSubscription(req.session.userId)) {
    return renderPage(res, 403, 'locked', {
      title: 'Membership required',
      metaDesc: 'This book is part of lifetime access.',
      book,
    });
  }
  next();
}

router.get('/:slug/:num/fragment', requireAuth, gate, (req, res, next) => {
  const n = parseInt(req.params.num, 10);
  if (!Number.isInteger(n)) return res.status(404).type('text/plain').send('not found');
  const ch = getChapter(req.book.id, n);
  if (!ch) return res.status(404).type('text/plain').send('not found');

  let body;
  try {
    body = JSON.parse(ch.sections_json);
  } catch (e) {
    return next(e);
  }
  let html = renderChapter(body, { book: req.book.slug });
  // Renumber sentence ids so TTS continues unbroken across the chapter seam.
  const sidBase = parseInt(req.query.sidBase || '0', 10) || 0;
  html = html.replace(/(\bdata-sid=")(\d+)(")/g, (_m, p1, p2, p3) => p1 + (sidBase + Number(p2)) + p3);
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
});

router.get('/:slug/:num', requireAuth, gate, renderChapterPage);
router.get('/:slug', requireAuth, gate, (req, res) => {
  const first = getChapters(req.book.id)[0];
  if (!first) {
    return renderPage(res, 404, '404', {
      title: 'No chapters yet',
      metaDesc: 'This book has no chapters yet.',
    });
  }
  res.redirect(`/read/${req.book.slug}/${first.number}`);
});

function renderChapterPage(req, res) {
  const { slug, num } = req.params;
  const n = parseInt(num, 10);
  if (!Number.isInteger(n)) {
    return renderPage(res, 404, '404', { title: 'Chapter not found', metaDesc: 'Chapter not found.' });
  }

  const chapters = getChapters(req.book.id);   // {number,title} for the chapter sheet
  const ch = getChapter(req.book.id, n);      // full row incl. sections_json
  if (!ch) {
    return renderPage(res, 404, '404', { title: 'Chapter not found', metaDesc: 'Chapter not found.' });
  }

  let body;
  try {
    body = JSON.parse(ch.sections_json);
  } catch (e) {
    console.error('section parse failed for', slug, n, e.message);
    return renderPage(res, 500, '500', { title: 'Chapter error', metaDesc: 'This chapter could not be loaded.' });
  }

  const ctx = { book: req.book.slug };
  const readerBody = renderChapter(body, ctx);
  const sentences = sentenceCount(body);
  const prev = chapters.find((c) => c.number === n - 1) || null;
  const nxt = chapters.find((c) => c.number === n + 1) || null;
  setProgress(req.session.userId, req.book.id, n);

  renderPage(res, 200, 'reader', {
    title: `Ch ${n}: ${ch.title}`,
    metaDesc: `${req.book.title} — Chapter ${n}: ${ch.title}`,
    book: req.book,
    chapter: { number: n, title: ch.title, next: nxt ? nxt.number : null },
    chapters,
    chapterNumbers: chapters.map((c) => c.number),
    readerBody,
    sentenceCount: sentences,
    // A pre-rendered Edge TTS track exists for this chapter. The dock uses
    // the device's own speech engine when it has one and falls back to this.
    hasNarration: hasAudio(req.book.slug, n),
    prev: prev ? { number: prev.number, title: prev.title } : null,
    next: nxt ? { number: nxt.number, title: nxt.title } : null,
  });
}

export default router;