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
import { createHash, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_ROOT = path.join(__dirname, '..', 'audio');

const CDN = (process.env.AUDIO_CDN_URL || '').replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Presigned read URLs
//
// The audiobook set is paid content, so making the bucket world-readable just
// to let a browser fetch it would publish it to anyone who can guess a path.
// Instead the bucket stays private and the app hands out short-lived S3
// signatures for the specific chapter a signed-in member is reading.
//
//   AUDIO_CDN_URL=https://…r2.dev     (or a custom domain)
//   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID
//   AUDIO_URL_TTL=<seconds, default 900>
//
// With no signing key configured, audioUrl() returns the plain CDN URL, and
// with no CDN at all it returns the local route. Each level is a fallback, not
// a branch the caller has to choose between.

const SIGN_KEY = process.env.R2_ACCESS_KEY_ID || '';
const SIGN_SECRET = process.env.R2_SECRET_ACCESS_KEY || '';
const SIGN_ENDPOINT = (process.env.R2_ENDPOINT || '').replace(/\/+$/, '');
const SIGN_BUCKET = process.env.R2_BUCKET || '';
const SIGN_REGION = 'auto';
const SIGN_TTL = Math.max(60, Math.min(86400, parseInt(process.env.AUDIO_URL_TTL, 10) || 900));

export const signingEnabled = !!(SIGN_KEY && SIGN_SECRET && SIGN_ENDPOINT && SIGN_BUCKET);

const sha256hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key, s) => createHmac('sha256', key).update(s, 'utf8').digest();

/** RFC 3986 encoding, which is stricter than encodeURIComponent for the path. */
const uriEncode = (s, encodeSlash) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%2F/g, encodeSlash ? '%2F' : '/');

/**
 * A presigned S3 GET URL, valid for SIGN_TTL seconds.
 * Only the host is signed, which is what a browser needs and keeps the
 * signature short.
 */
function presign(key) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const host = SIGN_ENDPOINT.replace(/^https?:\/\//, '');
  const objectKey = key.split('/').map((seg) => uriEncode(seg, true)).join('/');

  const scope = `${dateStamp}/${SIGN_REGION}/s3/aws4_request`;
  // Raw values here, encoded exactly once below. Pre-encoding and then encoding
  // again in the canonical query turns %2F into %252F, which R2 reads as a single
  // credential part and rejects.
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${SIGN_KEY}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(SIGN_TTL),
    'X-Amz-SignedHeaders': 'host',
  };
  // encodeSlash must stay true: R2 re-encodes each decoded value for the
  // canonical form, so a literal slash here signs a different string than the
  // one the server builds and every URL fails SignatureDoesNotMatch.
  const canonicalQuery = Object.keys(q)
    .sort()
    .map((k) => `${uriEncode(k, true)}=${uriEncode(q[k], true)}`)
    .join('&');

  const canonicalRequest = [
    'GET',
    `/${uriEncode(SIGN_BUCKET, false)}/${objectKey}`,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac('AWS4' + SIGN_SECRET, dateStamp);
  const kRegion = hmac(kDate, SIGN_REGION);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `https://${host}/${uriEncode(SIGN_BUCKET, false)}/${objectKey}` +
    `?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

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
  // The manifest is always built locally, even when the media itself is
  // delivered from R2. It is a small index of *which chapters have audio*, not
  // the media, and the reader needs it to show the audio affordance and to
  // decide whether a chapter is readable. Returning an empty manifest whenever a
  // CDN or signing key was configured made hasAudio() return false for every
  // chapter and silently hid the whole feature.
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

/**
 * Where a chapter's audio should be read from, in order of preference:
 *
 *   1. a presigned R2 URL, when signing keys are configured — the bucket stays
 *      private and a signed-in member gets a URL good for SIGN_TTL seconds
 *   2. the public CDN URL, when AUDIO_CDN_URL is set and the bucket is public
 *   3. the local route, which streams from disk
 *
 * The default for this deployment is (1): the audiobook set is paid content,
 * so the bucket is not world-readable and every read is authorised and short
 * lived.
 */
export function audioUrl(slug, chapter) {
  const s = safeSlug(slug);
  if (!s || !chapterRe.test(String(chapter))) return null;
  if (signingEnabled) return presign(`${s}/${chapter}.opus`);
  if (CDN) return `${CDN}/${s}/${chapter}.opus`;
  return `/audio/${s}/${chapter}.opus`;
}

/** How the audio for this deployment is being delivered, for diagnostics. */
export function audioDelivery() {
  return signingEnabled
    ? { mode: 'signed', ttl: SIGN_TTL, endpoint: SIGN_ENDPOINT }
    : CDN
      ? { mode: 'cdn', url: CDN }
      : { mode: 'local' };
}

export { CDN as AUDIO_CDN_URL, AUDIO_ROOT };