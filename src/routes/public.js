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

// ---- sample chapter for the landing page -----------------------------------
import { getBookBySlug, getChapter, getChapters } from '../model.js';
import { hasAudio } from '../audio.js';

/**
 * Paragraph blocks only. Read from the structured graph rather than from the
 * flattened narration text: a table flattened to "SI. No. Name. Constituency.
 * 1.. Ammu Swaminathan…" scores well on any heuristic (many periods, few
 * colons) and was picked as the landing page's showcase paragraph.
 */
function paragraphBlocks(sections) {
  const out = [];
  for (const sec of (sections || [])) {
    for (const b of (sec.blocks || [])) {
      if (b.kind !== 'para') continue;
      const t = (b.runs || []).map((r) => r.text || '').join('').replace(/\s+/g, ' ').trim();
      if (t.length >= 200) out.push(t);
    }
  }
  return out;
}

/** Prefer running text: no leading list marker, enough sentences, few digits. */
function proseScore(p) {
  const words = p.split(/\s+/).filter(Boolean);
  if (words.length < 45) return -1;
  const sentences = (p.match(/[.!?](\s|$)/g) || []).length;
  if (sentences < 3) return -1;
  if (/^\s*(?:\d+[.)]|[a-z][.)]|[-*•>]|#+\.?)\s/.test(p)) return -1;

  let s = Math.min(sentences, 12);
  s += (words.filter((w) => w.replace(/[^\w]/g, '').length > 7).length / words.length) * 40;
  s -= (p.match(/[=:#]|\b\d{4}\b/g) || []).length * 4;
  s -= /[A-Z]\.[A-Z]\./.test(p) ? 20 : 0;
  return s;
}

/**
 * Picks a real chapter and returns a real passage from it, returned as raw
 * text: the template escapes it once, and escaping here too rendered "&amp;"
 * on the page.
 */
function buildSample() {
  const candidates = [
    ['modern-indian-history', 1],
    ['indian-polity', 1],
    ['history-india-and-contemporary-world', 1],
    ['geography-india-physical-environment', 1],
    ['history-themes-in-world-history', 1],
    ['modern-indian-history', 2],
    ['indian-polity', 2],
  ];

  let best = null;

  for (const [slug, n] of candidates) {
    const book = getBookBySlug(slug);
    if (!book) continue;
    const chapter = getChapter(book.id, n);
    if (!chapter) continue;

    let sections;
    try {
      sections = JSON.parse(chapter.sections_json);
    } catch {
      continue;
    }

    const paras = paragraphBlocks(sections);
    const scored = paras
      .map((p) => ({ p, score: proseScore(p) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) continue;

    // Two consecutive paragraphs read as a passage; two arbitrary ones read
    // as a collage.
    let start = 0;
    for (let i = 0; i < paras.length - 1; i++) {
      if (scored.some((s) => s.p === paras[i]) && scored.some((s) => s.p === paras[i + 1])) {
        start = i;
        break;
      }
    }
    const first = scored.find((s) => s.p === paras[start]) || scored[0];

    const passage = [];
    for (let i = start; i < Math.min(paras.length, start + 2); i++) {
      const p = paras[i];
      passage.push(p.length > 420 ? p.slice(0, 420).replace(/\s+\S*$/, '') + '…' : p);
    }
    if (passage.length < 2) continue;

    const entry = {
      book: {
        slug: book.slug, title: book.title, author: book.author,
        subject: book.subject, color: book.color,
      },
      chapter: { n: chapter.number, title: chapter.title },
      totalChapters: getChapters(book.id).length,
      paragraphs: passage,
      hasAudio: hasAudio(slug, chapter.number),
      score: Math.round(first.score),
    };
    if (!best || entry.score > best.score) best = entry;
    if (best && best.score >= 30) break;
  }

  return best;
}

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
  const subjectCovers = {};
  for (const b of all) {
    const k = (b.subject || '').trim();
    if (!k) continue;
    subjectCount[k] = (subjectCount[k] || 0) + 1;
    if (!subjectSamples[k]) subjectSamples[k] = [];
    if (subjectSamples[k].length < 4) subjectSamples[k].push(b.title);
    // Three representative covers per subject, so the index reads as a shelf
    // rather than as six identical boxes with a count in them.
    if (!subjectCovers[k]) subjectCovers[k] = [];
    if (subjectCovers[k].length < 3) subjectCovers[k].push(b);
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

  // A real sample of the actual reading experience. The landing page was
  // showing feature bullets and no book content at all, which is a strange
  // thing to do on the front door of a library.
  const sample = buildSample();

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
    subjectCovers,
    shelfBooks,
    ncertShelf,
    sample,
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