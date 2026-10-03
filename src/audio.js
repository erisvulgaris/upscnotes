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

let manifestCache = null;
let manifestMtime = 0;

/**
 * Public index. Deliberately small: slug -> chapter -> {duration, bytes}.
 * The reader only needs to know which chapters have audio so it can show the
 * download/audio control and fall back at the right moment.
 */
export function buildManifest() {
  if (CDN) return { source: 'cdn', cdn: CDN, books: {} };

  let stat;
  try {
    stat = fs.statSync(AUDIO_ROOT);
  } catch {
    return { source: 'none', books: {} };
  }
  if (manifestCache && manifestMtime === stat.mtimeMs) return manifestCache;

  const books = {};
  let slugs = [];
  try {
    slugs = fs.readdirSync(AUDIO_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { slugs = []; }

  for (const slug of slugs) {
    if (!safeSlug(slug)) continue;
    const dir = path.join(AUDIO_ROOT, slug);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch { continue; }

    const chapters = {};
    for (const f of files) {
      const n = f.replace(/\.json$/, '');
      if (!chapterRe.test(n)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        chapters[n] = {
          duration: meta.duration,
          bytes: meta.bytes,
          words: meta.words,
          sentences: (meta.sentenceTimings || []).length,
          title: meta.title,
        };
      } catch { /* half-written file, skip */ }
    }
    if (Object.keys(chapters).length) books[slug] = chapters;
  }

  manifestCache = { source: 'local', books, builtAt: new Date().toISOString() };
  manifestMtime = stat.mtimeMs;
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