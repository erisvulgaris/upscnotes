// Cached reader for the per-book content bundles under content/<slug>.
//
// These files are large (questions.json ~1.9MB, mindmaps.json ~1.1MB,
// sections_text.json ~1.5MB for modern-indian-history). The original
// implementation re-read and re-parsed every one of them on each page
// render, which made the study-tools hub cost tens of megabytes of JSON
// parsing per request. Cache by path + mtime so a data refresh still wins.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CONTENT_ROOT = path.join(__dirname, '..', 'content');

const cache = new Map(); // absPath -> { mtimeMs, size, data }
const MISS = Symbol('miss');

export function readJsonCached(bookSlug, name) {
  const abs = path.join(CONTENT_ROOT, bookSlug, name);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    cache.delete(abs);
    return null;
  }
  const hit = cache.get(abs);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.data;

  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    data = null;
  }
  cache.set(abs, { mtimeMs: stat.mtimeMs, size: stat.size, data });
  return data;
}

// Books that actually ship a content/ bundle. The other 43 titles are
// reader-only (their chapters live in the database), so the study-tools
// hub must not advertise tools they cannot serve.
export function hasContentBundle(bookSlug) {
  try {
    return fs.statSync(path.join(CONTENT_ROOT, bookSlug)).isDirectory();
  } catch {
    return false;
  }
}

const len = (x) => (Array.isArray(x) ? x.length : 0);

// Counts for every study tool, derived from the cached bundles.
export function extrasCounts(bookSlug) {
  const questions = readJsonCached(bookSlug, 'questions.json');
  const flashcards = readJsonCached(bookSlug, 'flashcards.json');
  const mindmaps = readJsonCached(bookSlug, 'mindmaps.json');
  const maps = readJsonCached(bookSlug, 'maps.json');
  const mains = readJsonCached(bookSlug, 'mains_bank.json');
  const palette = readJsonCached(bookSlug, 'palette_terms.json');
  const sections = readJsonCached(bookSlug, 'sections_text.json');

  const timeline = mindmaps && mindmaps.timeline ? mindmaps.timeline : null;

  return {
    questions: len(questions && questions.questions),
    flashcards: (flashcards && flashcards.count) || len(flashcards && flashcards.cards),
    timeline: len(timeline && timeline.events),
    landmarks: len(timeline && timeline.landmarks),
    maps: len(maps && maps.maps),
    mains: len(mains && mains.entries),
    glossary: len(palette),
    sections: len(sections && sections.sections),
  };
}

// Only expose tools that actually have data for this book.
export function availableTools(bookSlug) {
  const c = extrasCounts(bookSlug);
  return [
    { slug: 'quiz', label: 'Question bank', count: c.questions, unit: 'questions', icon: ICONS.quiz },
    { slug: 'flashcards', label: 'Flashcards', count: c.flashcards, unit: 'cards', icon: ICONS.cards },
    { slug: 'timeline', label: 'Timeline', count: c.timeline, unit: 'events', icon: ICONS.clock },
    { slug: 'maps', label: 'Maps', count: c.maps, unit: 'maps', icon: ICONS.map },
    { slug: 'mains', label: 'Mains bank', count: c.mains, unit: 'questions', icon: ICONS.doc },
    { slug: 'glossary', label: 'Glossary', count: c.glossary, unit: 'terms', icon: ICONS.book },
    { slug: 'search', label: 'Search', count: c.sections, unit: 'sections', icon: ICONS.search },
  ].filter((t) => t.count > 0);
}

const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" aria-hidden="true"${extra}>${d}</svg>`;

export const ICONS = {
  quiz: svg('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  cards: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 4v16M2 12h20"/>'),
  clock: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  map: svg('<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><path d="M8 2v16M16 6v16"/>'),
  doc: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>'),
  book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  search: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
};