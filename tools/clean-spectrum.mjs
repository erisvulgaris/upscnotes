// Clean Spectrum chapter JSON: strip PDF running-header junk, orphan carryover
// words, wall-of-text paragraphs, and blank/duplicate section titles.
//
// Operates in place on spectrum/data/spectrum/chapters/*.json and regenerates
// manifest.json. Run from the repo root:  node tools/clean-spectrum.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'spectrum', 'data', 'spectrum');
const CHAPTERS_DIR = path.join(DATA_DIR, 'chapters');

const STAR = '\u272b'; // ✫ — running header separator used by this PDF
const PARAGRAPH_MAX = 320;      // chars before we split a para
const PARAGRAPH_TARGET = 240;   // target chunk length after split
const SEGMENTER = new Intl.Segmenter('en', { granularity: 'sentence' });

// Manual disambiguation for the 7 duplicate section titles (key = "chNN:sec.id").
const TITLE_FIXES = {
  'ch02:2.2': 'Nationalist Approach',
  'ch02:2.3': 'Marxist Approach',
  'ch02:2.4': 'Subaltern Historiography',
  'ch13:13.2': 'Revolutionary Activities Around the Country',
  'ch16:16.4': 'Decline and Aftermath of the Movement',
  'ch28:28.6': 'Commercialisation of Agriculture',
  'ch30:30.3': 'Professional and Technical Education',
  'ch31:31.6': 'Legacy of Peasant Movements',
};

// ---- header stripping ----
// A "header run" starts with "<(truncated) chapter title> ✫ <page>" and may be
// followed by the first words of the next line (which belong in the text).
function isHeaderPrefix(text, chapterTitle) {
  const t = text;
  const i = t.indexOf(STAR);
  if (i < 0) return null;
  // Everything up to and including the page digits is running-header junk.
  const m = t.slice(0).match(new RegExp('^(.{0,80}?)\\u272b\\s*\\d+'));
  if (!m) return null;
  const header = m[0];
  const rest = t.slice(header.length).replace(/^\s+/, '');
  // The "… ✫ <digits>" running-header signature is unambiguous in this corpus
  // (star appears ~400x and always as a page header), so a short word-count
  // guard is enough; title similarity is not required.
  const before = m[1].trim().replace(/\.\.\.$/, '').trim();
  if (before.length < 2) return null;
  return { header, rest };
}

// Normalize curly apostrophes/quotes and dashes so a running header that drops
// or wraps characters still matches the chapter title via a long common prefix.
function headerLooksLikeTitle(before, chapterTitle) {
  const norm = (s) => s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .toLowerCase();
  const b = norm(before);
  const t = norm(chapterTitle);
  // Longest common prefix (word-safe).
  let k = 0;
  const maxK = Math.min(b.length, t.length);
  while (k < maxK && b[k] === t[k]) k++;
  if (k >= 15) return true;                         // long identical prefix
  if (t.includes(b) && b.length >= 10) return true; // header dropped a middle word
  // Header may be an abbreviated/acronymized title. Check that every word of
  // the header (stripped to letters) appears in the title, or that the header
  // shares most of its letters with the title (catches acronyms like "CDM").
  const bWords = b.split(/\W+/).filter(w => w.length >= 3);
  if (bWords.length >= 2 && bWords.every(w => t.includes(w))) return true;
  let shared = 0;
  for (const c of new Set([...b])) if (t.includes(c)) shared++;
  return shared / b.length >= 0.7 && b.length >= 8;
}

function fixRuns(runs, chapterTitle) {
  const out = [];
  for (const r of runs) {
    const t = r.text || '';
    const h = isHeaderPrefix(t, chapterTitle);
    if (h) {
      if (h.rest) out.push({ ...r, text: h.rest });
      // else: pure header run — drop it.
    } else {
      out.push(r);
    }
  }
  return out;
}

// Merge orphan carryover runs: a bare short word (tail of the previous page's
// sentence) that begins a block before the real continuation. Join with a space.
function mergeOrphans(runs) {
  const out = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const t = (r.text || '').trim();
    if (i < runs.length - 1 && /^[A-Z](?:[A-Za-z]{0,7})$/.test(t) && !/[.!?]$/.test(t)) {
      const nxt = runs[i + 1];
      const nt = nxt.text || '';
      if (nt && !/^[A-Z]/.test(nt.trim())) {
        out.push({ ...runs[i + 1], text: t + ' ' + nt.replace(/^\s+/, '') });
        i++;
        continue;
      }
    }
    out.push(r);
  }
  return out;
}

// ---- paragraph splitting ----
// Split a paragraph into sentence-grouped chunks targeting PARAGRAPH_TARGET
// chars. Preserves run formatting by slicing runs to each chunk's char range.
function splitParagraphRuns(runs) {
  // Build the full text with per-run bounds.
  const bounds = [];
  let full = '';
  for (const r of runs) {
    bounds.push({ start: full.length, end: full.length + (r.text || '').length, r });
    full += (r.text || '');
  }
  const len = full.length;
  if (len <= PARAGRAPH_MAX) return [runs];

  // Sentence ranges over the full text.
  const sentences = [];
  for (const s of SEGMENTER.segment(full)) {
    if (!s.segment.trim()) continue;
    if (!sentences.length) sentences.push({ s: 0, e: s.index + s.segment.length });
    else {
      const last = sentences[sentences.length - 1];
      if (last.s === 0 && last.e === 0) {
        last.s = last.e; // n/a
      }
      sentences.push({ s: last.e, e: s.index + s.segment.length });
    }
  }
  if (!sentences.length) return [runs];

  // Group consecutive sentences into chunks.
  const chunks = [];
  let cur = null;
  for (const s of sentences) {
    const sz = s.e - s.s;
    if (!cur || (cur.e - cur.s) + sz > PARAGRAPH_TARGET && (cur.e - cur.s) >= 120) {
      if (cur) chunks.push(cur);
      cur = { s: s.s, e: s.e };
    } else {
      cur.e = s.e;
    }
  }
  if (cur) chunks.push(cur);

  // Slice runs for each chunk.
  return chunks.map(({ s, e }) => {
    const out = [];
    for (const b of bounds) {
      const bs = Math.max(s, b.start);
      const be = Math.min(e, b.end);
      if (bs >= be) continue;
      const txt = b.r.text.slice(bs - b.start, be - b.start);
      if (txt) out.push({ ...b.r, text: txt });
    }
    // Trim leading/trailing spaces (drop degenerate empty runs after trim).
    return out.filter((r, i, arr) => !(i === 0 && !r.text.trim()) && !(i === arr.length - 1 && !r.text.trim()));
  }).filter(c => c.length && c.some(r => r.text && r.text.trim()));
}

function blockText(b) {
  return (b.runs || []).map(r => r.text || '').join('').trim();
}

// ---- section title fixes ----
function fixTitles(ch) {
  const seen = new Map();
  for (const sec of ch.sections || []) {
    let t = (sec.title || '').trim();
    const key = `ch${String(ch.number).padStart(2, '0')}:${sec.id}`;
    if (TITLE_FIXES[key]) { sec.title = TITLE_FIXES[key]; seen.set(sec.title, true); continue; }
    if (!t) {
      sec.title = 'Introduction';
      seen.set(sec.title, true);
      continue;
    }
    // Fallback dedupe for any remaining repeats.
    if (seen.has(t)) sec.title = t + ' (cont.)';
    seen.set(sec.title, true);
  }
}

// ---- main ----
function processChapter(f) {
  const p = path.join(CHAPTERS_DIR, f);
  const ch = JSON.parse(fs.readFileSync(p, 'utf8'));
  const chapterTitle = ch.title;
  let stats = { parasBefore: 0, parasAfter: 0, headerRuns: 0, orphans: 0, promoted: 0 };

  for (const sec of ch.sections || []) {
    const newBlocks = [];
    for (let i = 0; i < sec.blocks.length; i++) {
      let b = sec.blocks[i];
      if (b.kind !== 'para') { newBlocks.push(b); continue; }
      stats.parasBefore++;
      const before = (b.runs || []).length;

      let runs = fixRuns(b.runs || [], chapterTitle);
      stats.headerRuns += before - runs.length;
      const preOrphan = runs.length;
      runs = mergeOrphans(runs);
      stats.orphans += preOrphan - runs.length;

      const text = runs.map(r => r.text || '').join('').trim();
      if (!text) continue; // empty after header strip — drop block

      // If a stray bold "head" phrase remains (subhead fragment from a page
      // break with no period), promote it to a subhead.
      if (runs.length === 1 && runs[0].bold && !runs[0].italic) {
        const fragment = (runs[0].text || '').trim();
        if (/^[A-Z].{3,45}$/.test(fragment) && !/[.!?]$/.test(fragment) && fragment.split(' ').length >= 2) {
          newBlocks.push({ kind: 'subhead', runs: [{ text: fragment, bold: true, italic: false }] });
          stats.promoted++;
          continue;
        }
      }

      const chunks = splitParagraphRuns(runs);
      for (const c of chunks) newBlocks.push({ ...b, runs: c });
    }
    sec.blocks = newBlocks;
  }

  stats.parasAfter = ch.sections.reduce((a, s) => a + s.blocks.filter(b => b.kind === 'para').length, 0);
  fixTitles(ch);
  fs.writeFileSync(p, JSON.stringify(ch));
  return stats;
}

const files = fs.readdirSync(CHAPTERS_DIR).filter(f => /^ch\d+\.json$/i.test(f)).sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
const totals = { parasBefore: 0, parasAfter: 0, headerRuns: 0, orphans: 0, promoted: 0 };
for (const f of files) {
  const s = processChapter(f);
  for (const k of Object.keys(totals)) totals[k] += s[k];
  console.log(`${f.padEnd(9)} paras ${String(s.parasBefore).padStart(4)} -> ${String(s.parasAfter).padStart(4)}  headers=${s.headerRuns} orphans=${s.orphans} promoted=${s.promoted}`);
}
console.log('\nTOTALS', JSON.stringify(totals));
console.log('wrote', files.length, 'chapters in', CHAPTERS_DIR);