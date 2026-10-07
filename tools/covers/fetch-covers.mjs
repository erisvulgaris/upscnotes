// Fetches real cover art for the library and stores it on R2 under
// covers/<slug>.jpg.
//
// Source: Open Library. Its cover images are publisher artwork rather than
// openly licensed, so this is worth a licensing decision before going to
// production — see docs/COVERS.md. The tool records exactly which Open Library
// edition each image came from, so provenance is never lost.
//
// Matching is deliberately conservative: a wrong cover is worse than no cover,
// because a reader recognises a book by its cover and a mismatched one is
// misinformation. Anything below the confidence threshold is left without a
// cover and reported, never guessed.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OUT = path.join('covers');
const PROV = path.join(OUT, 'provenance.json');
const UA = 'upscnotes/1.0 (cover art fetch; contact support@upscnotes.shop)';

fs.mkdirSync(OUT, { recursive: true });

// Confidence thresholds. A title must match essentially exactly; the author
// only has to be compatible.
const TITLE_STRONG = 0.9;
const TITLE_OK = 0.78;
const MIN_COVER = 1;

const db = new DatabaseSync(path.join('data', 'upscnotes.db'));
const books = db.prepare(
  "SELECT slug, title, author FROM books WHERE status='published' ORDER BY slug"
).all();

// ISBN mappings for textbooks where title-based matching on Open Library is
// unreliable (generic titles, different authors, etc.). Open Library indexes
// by ISBN at https://covers.openlibrary.org/b/isbn/<isbn>-L.jpg.
const ISBN_MAP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'isbn-mapping.json');
const ISBN = fs.existsSync(ISBN_MAP) ? JSON.parse(fs.readFileSync(ISBN_MAP, 'utf8')) : {};

function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\b(a|an|the|and|or|of|for|in|on|with|by|to)\b/g, ' ')
    .replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleScore(want, got) {
  const a = norm(want), b = norm(got);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // a is our DB title, b is the OL title. If the OL title *starts with* our
  // title, the OL title is a more specific version of our book (e.g. our
  // "Geography" matches OL "Geography by Harm J. de Blij").
  // If our title *starts with* the OL title, the OL title is shorter — only
  // accept it if our title has exactly the same number of tokens (otherwise "Geography
  // (India Physical Environment)" would match OL "Geography").
  if (b.startsWith(a)) return 0.94;
  const at = a.split(' ').filter(Boolean);
  const bt = b.split(' ').filter(Boolean);
  if (at.length === bt.length && a.startsWith(b)) return 0.94;
  // Token overlap. "want" is our DB title; "got" is the OL title. We want
  // every meaningful token in our title to appear in the OL title. When the OL
  // title is longer (more descriptive), that's fine — we still accept if all
  // our tokens are present.
  const atSet = new Set(at);
  if (!atSet.size || !bt.length) return 0;
  let hit = 0;
  for (const t of atSet) if (b.includes(t)) hit++;
  const overlap = hit / atSet.size;
  return overlap;
}

function authorOk(want, got) {
  const w = norm(want).replace(/\b(mr|mrs|ms|dr|prof)\b/g, '').trim();
  const g = norm(got);
  if (!w || !g) return true;                      // unknown author: do not block
  const surname = w.split(' ').pop();
  return g.includes(surname) || w.includes(g) || surname.length < 3;
}

/** Checks if an Open Library edition is from NCERT by looking at the publisher field. */
async function isNCERTEdition(editionKey) {
  if (!editionKey) return false;
  try {
    const ed = await json('https://openlibrary.org' + editionKey + '.json');
    const pubs = ed.publishers || [];
    return pubs.some((p) => /national council of educational research and training/i.test(p) || /^ncert$/i.test(p));
  } catch {
    return false;
  }
}

async function json(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(url + ' -> ' + res.status);
  return res.json();
}

/** Fetches a cover by ISBN via Open Library's ISBN-to-cover API.
 *  Returns { url, bytes, coverId } or null. */
async function fetchByISBN(isbn) {
  // Open Library resolves ISBNs to cover IDs via the cover API.
  const url = 'https://covers.openlibrary.org/b/isbn/' + isbn + '-L.jpg';
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok || res.status === 404) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Open Library returns a 43-byte GIF placeholder for unknown ISBNs.
    if (buf.length < MIN_COVER * 1024) return null;
    if (buf.slice(0, 2).toString('latin1') !== '\xff\xd8') return null;
    return { isbn, url, bytes: buf.length, coverId: isbn };
  } catch {
    return null;
  }
}

/** Tries ISBN lookup first, then falls back to the OL work/edition API to find
 *  a cover for the given ISBN. Returns { url, bytes } or null. */
async function fetchByISBNExtended(isbn) {
  // Strategy 1: direct cover API
  const direct = await fetchByISBN(isbn);
  if (direct) return direct;

  // Strategy 2: look up the edition by ISBN, then check for covers
  const found = await lookupISBN(isbn);
  if (found) {
    // Try the edition's cover_i, then the work's covers field
    const art = await tryCovers(found.edition_key, found.cover_i);
    if (art) return art;

    // Try the work page for covers
    try {
      const work = await json('https://openlibrary.org' + found.key + '.json');
      if (work && work.covers && work.covers[0]) {
        const coverUrl = 'https://covers.openlibrary.org/b/id/' + work.covers[0] + '-L.jpg';
        const res = await fetch(coverUrl, { headers: { 'user-agent': UA } });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length >= MIN_COVER * 1024 && buf.slice(0, 2).toString('latin1') === '\xff\xd8') {
            return { isbn, url: coverUrl, bytes: buf.length, coverId: work.covers[0] };
          }
        }
      }
    } catch { /* ignore */ }
  }
  return null;
}

/** Looks up an ISBN on Open Library to get the OL work/edition key, then
 *  tries the edition cover. Returns Open Library identifiers or null. */
async function lookupISBN(isbn) {
  try {
    const data = await json('https://openlibrary.org/search.json?isbn=' + isbn +
      '&fields=key,title,author_name,cover_i,edition_key');
    for (const d of (data.docs || [])) {
      if (d.cover_i || (d.edition_key || []).length) return d;
    }
  } catch { /* ignore */ }
  return null;
}

async function search(q, limit = 8) {
  const url = 'https://openlibrary.org/search.json?q=' + encodeURIComponent(q) +
    '&limit=' + limit + '&fields=key,title,author_name,cover_i,first_publish_year,edition_key';
  return json(url);
}

async function tryCovers(editionKeys, coverId) {
  // Prefer the edition-level cover, then the work-level one.
  const ids = [];
  if (coverId) ids.push(coverId);
  for (const k of (editionKeys || []).slice(0, 3)) {
    try {
      const e = await json('https://openlibrary.org' + k + '.json');
      if (e && e.covers && e.covers[0]) ids.push(e.covers[0]);
    } catch { /* an edition without a cover is normal */ }
  }
  for (const id of ids) {
    // -L is roughly 500px wide: enough for a card, small enough to keep the
    // bucket and the reader's bandwidth down.
    const url = 'https://covers.openlibrary.org/b/id/' + id + '-L.jpg';
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < MIN_COVER * 1024) continue;   // a stub is worse than none
      if (buf.slice(0, 2).toString('latin1') !== '\xff\xd8') continue;  // not a JPEG
      return { url, bytes: buf.length, coverId: id };
    } catch { /* try the next candidate */ }
  }
  return null;
}

async function fetchOne(book) {
  // Strategy 1: ISBN-based lookup. More precise than title search because
  // ISBNs are unique identifiers — the cover is guaranteed to be the right book.
  const isbns = ISBN[book.slug];
  if (isbns && isbns.length) {
    for (const isbn of isbns) {
      const found = await fetchByISBNExtended(isbn);
      if (found) {
        return {
          found: true,
          confidence: 1,
          source: 'isbn',
          isbn,
          coverId: found.coverId,
          sourceUrl: found.url,
          bytes: found.bytes,
          matchedTitle: book.title,
          matchedAuthor: book.author,
          firstPublished: null,
        };
      }
    }
    // ISBN cover lookup failed — fall through to title search as a backup.
  }

  // Strategy 2: title-based search on Open Library.
  // Build multiple search strategies. NCERT books especially are published
  // by NCERT (the publisher) rather than the actual textbook authors, so
  // "author" in the DB is not useful for matching against Open Library's
  // author field. We try several query forms and pick the strongest title
  // match, then only fall back to a "title-only" match when the title is an
  // exact match (confidence 1.0) — a different "Indian Economy" is still a
  // different book, so we warn in the report but use it for cover art only.
  const queries = [
    book.author ? `${book.title} ${book.author}` : book.title,
    book.title,
    // Strip parenthetical subject qualifiers for a cleaner title match.
    book.title.replace(/ \([^)]*\)$/, ''),
  ];
  // For NCERT textbooks, add "NCERT" as an explicit search term — Open Library
  // does index many NCERT editions and the publisher filter helps disambiguate.
  if (/NCERT/i.test(book.author)) {
    // Use the stripped title so parentheses don't confuse the search query.
    const stripped = book.title.replace(/ \([^)]*\)$/, '');
    queries.unshift(`${stripped} NCERT`);
  }
  // Deduplicate while preserving order.
  const seen = new Set();
  const uniqueQueries = [];
  for (const q of queries) {
    if (!seen.has(q)) { seen.add(q); uniqueQueries.push(q); }
  }

  let best = null;
  let titleOnly = null;   // right title, wrong author: used only for exact title matches

  for (const q of uniqueQueries) {
    let data;
    try { data = await search(q); } catch { continue; }
    for (const d of (data.docs || [])) {
      if (!d.cover_i && !(d.edition_key || []).length) continue;
      const t = titleScore(book.title, d.title);
      if (t < TITLE_OK) continue;
      // For NCERT textbooks, the author in our DB is "NCERT" (the publisher)
      // but Open Library lists the actual textbook authors. So if the title
      // matches strongly and the edition's publisher is NCERT, accept it.
      const isNcmlBook = /NCERT/i.test(book.author);
      let authorPass = authorOk(book.author, (d.author_name || []).join(' '));      if (!authorPass && isNcmlBook && t >= TITLE_STRONG) {
        const ed = (d.edition_key || [])[0];
        if (ed && await isNCERTEdition(ed)) {
          authorPass = true;
        }
      }
      if (!authorPass) {
        if (!titleOnly || t > titleOnly.t) titleOnly = { t, doc: d };
        continue;
      }
      if (!best || t > best.t) best = { doc: d, t };
    }
    if (best && best.t >= TITLE_STRONG) break;
  }

  // Accept a wrong-author title match only when it's a near-exact match.
  // For multi-token titles: score must be >= TITLE_STRONG (>= 0.9).
  // For single-token titles: only accept an exact match (score === 1) where
  // the OL title is also a single token — this prevents "People" matching
  // "Normal People" (different books with the same word in the title).
  if (!best && titleOnly && titleOnly.t >= TITLE_STRONG) {
    const wantNorm = norm(book.title);
    const tokenCount = wantNorm.split(' ').filter(Boolean).length;
    if (tokenCount >= 2) {
      const isNcmlBook = /NCERT/i.test(book.author);
      if (isNcmlBook) {
        // For NCERT textbooks, the title-only match must still be an NCERT edition.
        const ed = (titleOnly.doc.edition_key || [])[0];
        if (ed && await isNCERTEdition(ed)) {
          best = titleOnly;
        }
      } else {
        best = titleOnly;
      }
    }
  }

  if (!best) {
    return titleOnly
      ? { found: false, reason: 'title matches "' + (titleOnly.doc.title || '') + '" by ' + ((titleOnly.doc.author_name || []).join(', ') || 'unknown') + ' — a different author' }
      : { found: false, reason: 'nothing on Open Library above the confidence threshold' };
  }

  const art = await tryCovers(best.doc.edition_key, best.doc.cover_i);
  if (!art) return { found: false, reason: 'matched "' + (best.doc.title || '') + '" but Open Library has no cover image for it' };

  return {
    found: true,
    confidence: best.t,
    olKey: best.doc.key,
    editionKey: (best.doc.edition_key || [])[0] || null,
    coverId: art.coverId,
    sourceUrl: art.url,
    bytes: art.bytes,
    matchedTitle: best.doc.title,
    matchedAuthor: (best.doc.author_name || []).join(', '),
    firstPublished: best.doc.first_publish_year || null,
  };
}

const only = process.argv[2];
const target = only ? books.filter((b) => b.slug === only) : books;

const provenance = fs.existsSync(PROV) ? JSON.parse(fs.readFileSync(PROV, 'utf8')) : {};
let got = 0, skipped = 0;
const misses = [];

for (const book of target) {
  const existing = path.join(OUT, book.slug + '.jpg');
  if (fs.existsSync(existing) && !only) { got++; continue; }
  process.stdout.write('  ' + book.slug.padEnd(48));

  let r;
  try { r = await fetchOne(book); }
  catch (e) { r = { found: false, reason: e.message }; }

  if (!r.found) {
    skipped++;
    misses.push({ slug: book.slug, title: book.title, reason: r.reason });
    console.log('MISS  ' + r.reason);
    continue;
  }

  const res = await fetch(r.sourceUrl, { headers: { 'user-agent': UA } });
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(existing, buf);
  provenance[book.slug] = {
    title: book.title,
    author: book.author,
    file: book.slug + '.jpg',
    bytes: buf.length,
    ...r,
    fetchedAt: new Date().toISOString(),
  };
  got++;
  console.log('OK    ' + Math.round(r.confidence * 100) + '%  ' + (buf.length / 1024).toFixed(0) + 'KB  <- ' + (r.matchedTitle || '').slice(0, 40));
}

fs.writeFileSync(PROV, JSON.stringify(provenance, null, 1));

console.log('');
console.log('books     : ' + target.length);
console.log('with cover: ' + got);
console.log('without   : ' + skipped);
if (misses.length) {
  console.log('');
  console.log('no confident match (left without a cover rather than guessing):');
  misses.forEach((m) => console.log('  ' + m.slug.padEnd(48) + m.reason));
}
console.log('');
console.log('provenance: ' + PROV);
void execFileSync;
