import { Router } from 'express';
import { renderPage } from '../render.js';
import { listBooks, listBooksByCategory } from '../model.js';
import { hasContentBundle, availableTools } from '../content-cache.js';

// Preferred display order for library groupings; anything else trails.
const SUBJECT_ORDER = [
  'History', 'Political Science', 'Geography', 'Economics',
  'Environment', 'Social Science', 'Psychology',
];
const SUBJECT_ALIAS = { Economy: 'Economics' };

export function subjectKey(book) {
  const raw = (book.subject || '').trim();
  return raw ? (SUBJECT_ALIAS[raw] || raw) : 'Others';
}

export function groupBySubject(books) {
  const buckets = new Map();
  for (const b of books) {
    const key = subjectKey(b);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(b);
  }
  const order = [
    ...SUBJECT_ORDER,
    ...[...buckets.keys()].filter((s) => !SUBJECT_ORDER.includes(s)),
  ];
  return order
    .filter((s) => buckets.has(s))
    .map((subject) => ({ subject, anchor: slugify(subject), books: buckets.get(subject) }));
}

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function published() {
  return listBooks().filter((b) => b.status === 'published');
}

const router = Router();

// ---------------------------------------------------------------- home
router.get('/', (req, res) => {
  const all = published();
  const textbooks = all.filter((b) => b.category !== 'ncert');
  const ncerts = all.filter((b) => b.category === 'ncert');
  const allChapters = all.reduce((s, b) => s + (b.chapter_count || 0), 0);

  const subjects = [...new Set(all.map((b) => (b.subject || '').trim()).filter(Boolean))]
    .sort((a, b) => {
      const ia = SUBJECT_ORDER.indexOf(a);
      const ib = SUBJECT_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.localeCompare(b);
    });

  const subjectCount = {};
  const subjectSamples = {};
  for (const b of all) {
    const k = (b.subject || '').trim();
    if (!k) continue;
    subjectCount[k] = (subjectCount[k] || 0) + 1;
    if (!subjectSamples[k]) subjectSamples[k] = [];
    if (subjectSamples[k].length < 4) subjectSamples[k].push(b.title);
  }

  // Spotlight: the richest book that actually ships study tools.
  let spotlight = null;
  let spotlightExtras = null;
  for (const b of textbooks) {
    if (!hasContentBundle(b.slug)) continue;
    const tools = availableTools(b.slug);
    if (!spotlight || tools.length > spotlightExtras.length) {
      spotlight = b;
      spotlightExtras = tools;
    }
    if (spotlightExtras.length >= 5) break;
  }

  // Hero shelf: the four longest titles, so the covers read as real books.
  const shelfBooks = [...all]
    .sort((a, b) => (b.chapter_count || 0) - (a.chapter_count || 0))
    .slice(0, 4);

  // NCERT strip: one representative title per subject, longest first.
  const ncertShelf = [];
  const seenSubject = new Set();
  for (const b of [...ncerts].sort((a, c) => (c.chapter_count || 0) - (a.chapter_count || 0))) {
    const k = (b.subject || '').trim() || 'Other';
    if (seenSubject.has(k)) continue;
    seenSubject.add(k);
    ncertShelf.push(b);
  }

  renderPage(res, 200, 'home', {
    title: 'Civil services book library',
    metaDesc: `One lifetime library for UPSC — ${ncerts.length} NCERT textbooks, ${textbooks.length} standard UPSC titles, ${allChapters} chapters with text-to-speech reading, search and practice material.`,
    textbooks,
    ncertCount: ncerts.length,
    totalBooks: all.length,
    allChapters,
    subjects,
    subjectCount,
    subjectSamples,
    shelfBooks,
    ncertShelf,
    spotlight,
    spotlightExtras,
  });
});

// ------------------------------------------------------------- library
router.get('/library', (req, res) => {
  const all = published();
  const groups = groupBySubject(all);
  const allChapters = all.reduce((s, b) => s + (b.chapter_count || 0), 0);
  // Only offer a "Study tools" link for titles that ship a content bundle —
  // otherwise the hub opens onto an empty page.
  const hasExtras = {};
  for (const b of all) hasExtras[b.slug] = hasContentBundle(b.slug);
  renderPage(res, 200, 'library', {
    title: 'All books',
    metaDesc: `Browse all ${all.length} books in the UPSCbooks library, grouped by subject.`,
    groups,
    books: all,
    hasExtras,
    totalBooks: all.length,
    allChapters,
    ncertCount: all.filter((b) => b.category === 'ncert').length,
  });
});

// -------------------------------------------------------------- search
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  const all = published();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);

  let results = [];
  if (terms.length) {
    results = all.filter((b) => {
      const hay = `${b.title} ${b.author} ${b.subject} ${b.description || ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  renderPage(res, 200, 'search', {
    title: q ? `Search: ${q}` : 'Search',
    metaDesc: 'Search every title, author and subject in the UPSCbooks library.',
    q,
    results,
    searched: terms.length > 0,
    totalBooks: all.length,
  });
});

// --------------------------------------------------------------- NCERT
router.get('/ncerts', (req, res) => {
  const ncerts = listBooksByCategory('ncert');
  const subjects = {};
  for (const b of ncerts) {
    const subj = (b.subject || '').trim() || 'Other';
    if (!subjects[subj]) subjects[subj] = [];
    subjects[subj].push(b);
  }
  const chapters = ncerts.reduce((s, b) => s + (b.chapter_count || 0), 0);
  renderPage(res, 200, 'ncerts', {
    title: 'NCERT Textbooks',
    metaDesc: `All ${ncerts.length} NCERT textbooks — ${chapters} chapters across History, Geography, Economics, Political Science and Social Science.`,
    subjects,
    ncertCount: ncerts.length,
    allChapters: chapters,
  });
});

// ------------------------------------------------------- legal / policy
const LEGAL = {
  terms: {
    title: 'Terms of Service',
    metaDesc: 'Terms of service for the UPSCbooks digital library.',
  },
  privacy: {
    title: 'Privacy Policy',
    metaDesc: 'How UPSCbooks handles your account and reading data.',
  },
  refunds: {
    title: 'Refund Policy',
    metaDesc: '7-day money-back guarantee on lifetime access.',
  },
};

for (const [slug, meta] of Object.entries(LEGAL)) {
  router.get(`/${slug}`, (req, res) => {
    renderPage(res, 200, `legal/${slug}`, meta);
  });
}

export default router;