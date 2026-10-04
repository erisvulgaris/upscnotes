// Serves the pre-rendered Edge TTS audio and the manifest that describes it.
//
// Layout on disk (and therefore the layout to upload to Cloudflare R2):
//   audio/<slug>/<chapter>.opus      16 kHz mono Opus, ~24 kbps
//   audio/<slug>/<chapter>.json      timings + metadata sidecar
//
// R2 is the intended home for the media; AUDIO_CDN_URL lets the app point at
// the public bucket instead. When it is set the app serves a small manifest
// and redirects media to the CDN rather than streaming from disk.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_ROOT = path.join(__dirname, '..', 'audio');

const CDN = (process.env.AUDIO_CDN_URL || '').replace(/\/+$/, '');

// slug/n must be conservative: this value becomes a filesystem path.
const SAFE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const chapterRe = /^[0-9]{1,5}$/;

export function safeSlug(slug) {
  const s = String(slug || '').toLowerCase();
  return SAFE.test(s) ? s : null;
}

// Per-chapter summaries, cached permanently by path + mtime + size.
//
// Caching the whole manifest on the mtime of audio/ looks right and is not:
// that directory's mtime changes every time the build adds a chapter, so
// during a build *every* request rebuilt the manifest - 2.5s and 25MB of JSON
// parsing per request. An existing sidecar's content never changes, so each
// file is parsed once and only new files cost anything.
const summaryCache = new Map(); // "slug/n.json" -> { mtimeMs, size, summary }

function summarise(slug, chapter, file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    summaryCache.delete(slug + '/' + chapter + '.json');
    return null;
  }

  const key = slug + '/' + chapter + '.json';
  const hit = summaryCache.get(key);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.summary;

  let summary = null;
  try {
    const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
    summary = {
      duration: meta.duration,
      bytes: meta.bytes,
      words: meta.words,
      sentences: (meta.sentenceTimings || []).length,
      title: meta.title,
    };
  } catch {
    // Half-written or corrupt: fall back to the size so the chapter can still
    // be served if the audio exists.
    summary = { duration: null, bytes: stat.size, words: null, sentences: 0, title: null };
  }
  summaryCache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, summary });
  return summary;
}

let manifestCache = null;
let manifestBuiltAt = 0;
let manifestMtime = 0;

/**
 * Public index. Deliberately small: slug -> chapter -> {duration, bytes}.
 * The reader only needs to know which chapters have audio so it can show the
 * audio affordance and fall back at the right moment.
 */
export function buildManifest() {
  if (CDN) return { source: 'cdn', cdn: CDN, books: {} };

  // Keep the served manifest for a short window so a burst of requests, or a
  // build adding files, cannot turn this into a per-request cost.
  if (manifestCache && Date.now() - manifestBuiltAt < 30_000) return manifestCache;

  // Preferred path: the build writes a single index. Reading it is one file
  // open, versus 596 sidecar parses for a full scan - 3.9s under load versus
  // about a millisecond.
  const indexPath = path.join(AUDIO_ROOT, 'manifest.json');
  try {
    const stat = fs.statSync(indexPath);
    if (manifestCache && manifestMtime === stat.mtimeMs) {
      manifestBuiltAt = Date.now();
      return manifestCache;
    }
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    manifestCache = {
      source: 'local',
      books: parsed.books || {},
      builtAt: parsed.generatedAt,
      generatedAt: parsed.generatedAt,
      chapterCount: parsed.chapterCount,
      totalHours: parsed.totalHours,
      totalBytes: parsed.totalBytes,
    };
    manifestMtime = stat.mtimeMs;
    manifestBuiltAt = Date.now();
    return manifestCache;
  } catch {
    // No index yet (or it is half-written): fall through to the scan.
  }

  const books = {};
  let slugs = [];
  try {
    slugs = fs.readdirSync(AUDIO_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { slugs = []; }

  for (const slug of slugs) {
    if (!safeSlug(slug) || slug === 'logs') continue;
    const dir = path.join(AUDIO_ROOT, slug);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch { continue; }

    const chapters = {};
    for (const f of files) {
      const n = f.replace(/\.json$/, '');
      if (!chapterRe.test(n)) continue;
      const summary = summarise(slug, n, path.join(dir, f));
      if (summary) chapters[n] = summary;
    }
    if (Object.keys(chapters).length) books[slug] = chapters;
  }

  manifestCache = { source: 'local', books, builtAt: new Date().toISOString(), scanned: true };
  manifestBuiltAt = Date.now();
  return manifestCache;
}

export function hasAudio(slug, chapter) {
  const m = buildManifest();
  const s = safeSlug(slug);
  if (!s || !m.books[s]) return false;
  return !!m.books[s][String(chapter)];
}

export function audioMeta(slug, chapter) {
  const m = buildManifest();
  const s = safeSlug(slug);
  if (!s || !m.books[s]) return null;
  return m.books[s][String(chapter)] || null;
}

/** Timings for one chapter, used to drive sentence highlighting. */
export function readTimings(slug, chapter) {
  const s = safeSlug(slug);
  if (!s || !chapterRe.test(String(chapter))) return null;
  const file = path.join(AUDIO_ROOT, s, `${chapter}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function audioPath(slug, chapter) {
  const s = safeSlug(slug);
  if (!s || !chapterRe.test(String(chapter))) return null;
  const abs = path.join(AUDIO_ROOT, s, `${chapter}.opus`);
  // Defence in depth: the resolved path must stay inside AUDIO_ROOT.
  if (!abs.startsWith(AUDIO_ROOT + path.sep)) return null;
  return fs.existsSync(abs) ? abs : null;
}

/** Public URL for a chapter's audio (CDN if configured, else local route). */
export function audioUrl(slug, chapter) {
  if (CDN) return `${CDN}/${safeSlug(slug)}/${chapter}.opus`;
  return `/audio/${safeSlug(slug)}/${chapter}.opus`;
}

export { CDN as AUDIO_CDN_URL, AUDIO_ROOT };