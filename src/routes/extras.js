import { Router } from 'express';
import { renderPage } from '../render.js';
import { getBookBySlug, getChapters, getActiveSubscription, countChapters } from '../model.js';
import { requireAuth } from '../middleware.js';
import { readJsonCached, extrasCounts, availableTools, hasContentBundle } from '../content-cache.js';

const router = Router();

// Auth + subscription gate. Fails closed with the locked stub, and records
// whether the book actually ships a study-tools bundle so the hub can say so
// instead of advertising tools that render nothing.
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
  req.hasTools = hasContentBundle(book.slug);
  req.chapters = getChapters(book.id);
  req.tools = availableTools(book.slug);
  next();
}

// Every tool page shares this shape. `page` is a route local on purpose:
// EJS includes run in their own scope, so a template-declared variable would
// not be visible to _nav.ejs.
function toolsPage(req, res, page, title, extra = {}) {
  if (!req.hasTools) return res.redirect('/read/' + req.book.slug + '/1');
  return renderPage(res, 200, 'extras/' + page, {
    title: `${req.book.title} — ${title}`,
    metaDesc: `${title} for ${req.book.title}.`,
    book: req.book,
    chapters: req.chapters,
    tools: req.tools,
    page,
    exCss: true,
    exJs: true,
    ...extra,
  });
}

// ---------------------------------------------------------------- hub
router.get('/:slug', requireAuth, gate, (req, res) => {
  if (!req.hasTools) return res.redirect('/read/' + req.book.slug + '/1');

  renderPage(res, 200, 'extras/hub', {
    title: `${req.book.title} — Study tools`,
    metaDesc: `Question bank, flashcards, timeline, maps, mains prompts and glossary for ${req.book.title}.`,
    book: req.book,
    counts: extrasCounts(req.book.slug),
    tools: req.tools,
    chapterCount: countChapters(req.book.id),
    chapters: req.chapters,
    page: '',
    exCss: true,
    exJs: true,
  });
});

// --------------------------------------------------------------- quiz
router.get('/:slug/quiz', requireAuth, gate, (req, res) =>
  toolsPage(req, res, 'quiz', 'Question bank', {
    qCh: String(req.query.ch || ''),
    qKind: String(req.query.kind || ''),
  }));

// ---------------------------------------------------------- timeline
router.get('/:slug/timeline', requireAuth, gate, (req, res) => {
  if (!req.hasTools) return res.redirect('/read/' + req.book.slug + '/1');
  const mm = readJsonCached(req.book.slug, 'mindmaps.json');
  const timeline = (mm && mm.timeline) || {};
  // Guard: a missing events/landmarks array used to crash this template.
  const landmarks = Array.isArray(timeline.landmarks) ? timeline.landmarks : [];
  const events = Array.isArray(timeline.events) ? timeline.events : [];
  return renderPage(res, 200, 'extras/timeline', {
    title: `${req.book.title} — Timeline`,
    metaDesc: `Every dated event in ${req.book.title}, in order.`,
    book: req.book,
    chapters: req.chapters,
    tools: req.tools,
    page: 'timeline',
    eventCount: events.length,
    landmarkCount: landmarks.length,
    // Events render client-side; only the era chips ride along in the HTML.
    // They travel as a data attribute because a raw EJS tag inside a <script>
    // block trips EJS's tag tokenizer.
    landmarksJson: JSON.stringify(landmarks.map((l) => l.label || l.name || l.title || '')),
    exCss: true,
    exJs: true,
  });
});

// --------------------------------------------------------- flashcards
router.get('/:slug/flashcards', requireAuth, gate, (req, res) =>
  toolsPage(req, res, 'flashcards', 'Flashcards'));

// -------------------------------------------------------------- maps
router.get('/:slug/maps', requireAuth, gate, (req, res) =>
  toolsPage(req, res, 'maps', 'Maps'));

// ------------------------------------------------------- mains bank
router.get('/:slug/mains', requireAuth, gate, (req, res) =>
  toolsPage(req, res, 'mains', 'Mains bank'));

// ----------------------------------------------------------- glossary
router.get('/:slug/glossary', requireAuth, gate, (req, res) => {
  if (!req.hasTools) return res.redirect('/read/' + req.book.slug + '/1');
  // The term list runs to thousands of entries, so it renders client-side.
  // Chapter titles ride along in a data attribute for the captions.
  return renderPage(res, 200, 'extras/glossary', {
    title: `${req.book.title} — Glossary`,
    metaDesc: `Every key term in ${req.book.title}, linked to its chapter.`,
    book: req.book,
    chapters: req.chapters,
    tools: req.tools,
    page: 'glossary',
    chaptersJson: JSON.stringify(req.chapters.map((c) => ({ number: c.number, title: c.title }))),
    exCss: true,
    exJs: true,
  });
});

// ------------------------------------------------------------ search
router.get('/:slug/search', requireAuth, gate, (req, res) =>
  toolsPage(req, res, 'search', 'Search', { q: String(req.query.q || '').slice(0, 120) }));

export default router;