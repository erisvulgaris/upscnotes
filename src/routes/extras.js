import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPage } from '../render.js';
import { getBookBySlug, getChapters, getActiveSubscription, getChapter } from '../model.js';
import { requireAuth } from '../middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = path.join(__dirname, '..', '..', 'content');

const router = Router();

// Auth + subscription gate. Fails closed with the locked stub.
function gate(req, res, next) {
  const { slug } = req.params;
  req.book = getBookBySlug(slug);
  if (!req.book) return renderPage(res, 404, '404', { title: 'Book not found' });
  if (!getActiveSubscription(req.session.userId)) {
    return renderPage(res, 403, 'locked', { title: 'Membership required', book: req.book });
  }
  next();
}

function bookDir(slug) {
  return path.join(CONTENT_ROOT, slug);
}

function readJson(slug, name) {
  const p = path.join(bookDir(slug), name);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

function extrasMeta(req) {
  const slug = req.book.slug;
  const chapters = getChapters(req.book.id);
  const questions = readJson(slug, 'questions.json');
  const flashcards = readJson(slug, 'flashcards.json');
  const mindmaps = readJson(slug, 'mindmaps.json');
  const maps = readJson(slug, 'maps.json');
  const mains = readJson(slug, 'mains_bank.json');
  const palette = readJson(slug, 'palette_terms.json');
  const sections = readJson(slug, 'sections_text.json');
  const timeline = mindmaps && mindmaps.timeline ? mindmaps.timeline : null;
  return {
    chapters,
    counts: {
      questions: questions && questions.questions ? questions.questions.length : 0,
      flashcards: flashcards && flashcards.count ? flashcards.count : (flashcards && flashcards.cards ? flashcards.cards.length : 0),
      timeline: timeline && timeline.events ? timeline.events.length : 0,
      maps: maps && maps.maps ? maps.maps.length : 0,
      mains: mains && mains.entries ? mains.entries.length : 0,
      glossary: palette ? palette.length : 0,
      sections: sections && sections.sections ? sections.sections.length : 0,
    },
  };
}

// ---- hub ----
router.get('/:slug', requireAuth, gate, (req, res) => {
  renderPage(res, 200, 'extras/hub', {
    title: `${req.book.title} — Study tools`,
    book: req.book,
    meta: extrasMeta(req),
    exCss: true,
  });
});

// ---- quiz ----
router.get('/:slug/quiz', requireAuth, gate, (req, res) => {
  const chapters = getChapters(req.book.id);
  renderPage(res, 200, 'extras/quiz', {
    title: `${req.book.title} — Question bank`,
    book: req.book,
    chapters,
    qCh: req.query.ch || '',
    qKind: req.query.kind || '',
    exCss: true,
    exJs: true,
  });
});

// ---- timeline ----
router.get('/:slug/timeline', requireAuth, gate, (req, res) => {
  const mm = readJson(req.book.slug, 'mindmaps.json');
  const timeline = mm && mm.timeline ? mm.timeline : { landmarks: [], events: [] };
  renderPage(res, 200, 'extras/timeline', {
    title: `${req.book.title} — Timeline`,
    book: req.book,
    timeline,
    exCss: true,
  });
});

// ---- flashcards ----
router.get('/:slug/flashcards', requireAuth, gate, (req, res) => {
  const chapters = getChapters(req.book.id);
  renderPage(res, 200, 'extras/flashcards', {
    title: `${req.book.title} — Flashcards`,
    book: req.book,
    chapters,
    exCss: true,
    exJs: true,
  });
});

// ---- maps ----
router.get('/:slug/maps', requireAuth, gate, (req, res) => {
  const chapters = getChapters(req.book.id);
  renderPage(res, 200, 'extras/maps', {
    title: `${req.book.title} — Maps`,
    book: req.book,
    chapters,
    exCss: true,
    exJs: true,
  });
});

// ---- mains bank ----
router.get('/:slug/mains', requireAuth, gate, (req, res) => {
  renderPage(res, 200, 'extras/mains', {
    title: `${req.book.title} — Mains bank`,
    book: req.book,
    exCss: true,
    exJs: true,
  });
});

// ---- glossary / palette ----
router.get('/:slug/glossary', requireAuth, gate, (req, res) => {
  const data = readJson(req.book.slug, 'palette_terms.json');
  const terms = data || [];
  const chapters = getChapters(req.book.id);
  renderPage(res, 200, 'extras/glossary', {
    title: `${req.book.title} — Glossary`,
    book: req.book,
    terms,
    chapters,
    exCss: true,
    exJs: true,
  });
});

// ---- search (sections full text) ----
router.get('/:slug/search', requireAuth, gate, (req, res) => {
  renderPage(res, 200, 'extras/search', {
    title: `${req.book.title} — Search`,
    book: req.book,
    q: req.query.q || '',
    exCss: true,
    exJs: true,
  });
});

export default router;