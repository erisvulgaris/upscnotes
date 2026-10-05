// Serves book cover images from Cloudflare R2 (or locally during development).
//
// Layout on disk (and in R2):
//   covers/<slug>.jpg         fetched cover art (Open Library publisher artwork)
//
// In production, COVER_CDN_URL points to a public R2 bucket or r2.dev domain
// and the browser fetches covers directly. When the bucket is private (or
// COVER_CDN_URL is unset), the /covers route redirects to a short-lived
// presigned URL — same pattern as audio (src/audio.js).
//
// Local development: covers are served from the covers/ directory on disk.

import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COVERS_DIR = path.join(process.cwd(), 'covers');

const CDN = (process.env.COVER_CDN_URL || '').replace(/\/+$/, '');

// R2 signing (same pattern as src/audio.js presign).
const KEY = process.env.R2_ACCESS_KEY_ID || '';
const SECRET = process.env.R2_SECRET_ACCESS_KEY || '';
const ENDPOINT = (process.env.R2_ENDPOINT || '').replace(/\/+$/, '');
const BUCKET = process.env.R2_BUCKET || '';
const REGION = 'auto';
const TTL = Math.max(60, Math.min(86400, parseInt(process.env.COVER_URL_TTL, 10) || 3600));

const host = ENDPOINT.replace(/^https?:\/\//, '');
const sha256hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key, s) => createHmac('sha256', key).update(s, 'utf8').digest();

// AWS v4 query parameter encoding: encode everything except unreserved chars.
// Query parameter values keep %2F (encoded slashes) — the server decodes the
// URL and re-encodes for the canonical form, so we must match that.
function paramEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

const SAFE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function safeSlug(slug) {
  const s = String(slug || '').toLowerCase();
  return SAFE.test(s) ? s : null;
}

const signingEnabled = !!(KEY && SECRET && ENDPOINT && BUCKET);

/** Generates a short-lived presigned URL for a cover in R2. */
function presignCover(key) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const objectKey = key.split('/').map((seg) =>
    encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  ).join('/');

  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${KEY}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(TTL),
    'X-Amz-SignedHeaders': 'host',
  };

  // Canonical query: each param name and value is URI-encoded (%2F for slashes).
  const canonicalQuery = Object.keys(q)
    .sort()
    .map((k) => `${paramEncode(k)}=${paramEncode(q[k])}`)
    .join('&');

  const canonicalRequest = [
    'GET',
    `/${paramEncode(BUCKET)}/${objectKey}`,
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

  const kDate = hmac('AWS4' + SECRET, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  // Final URL: same encoded query string (keeps %2F which the server decodes).
  return `https://${host}/${paramEncode(BUCKET)}/${objectKey}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Returns the URL path that the browser should request for this book's cover.
 *  This is always the local route; the route itself picks between CDN, presigned,
 *  or disk serving. */
export function coverUrl(slug) {
  const s = safeSlug(slug);
  if (!s) return null;
  return `/covers/${s}.jpg`;
}

/** Returns the actual URL to redirect to (CDN, presigned, or null for disk). */
export function coverRedirect(slug) {
  const s = safeSlug(slug);
  if (!s) return null;
  const key = `covers/${s}.jpg`;
  if (CDN) return `${CDN}/${s}.jpg`;
  if (signingEnabled) return presignCover(key);
  return null;  // fall through to disk serving
}

/** Whether any cover has been configured for this deployment. */
export function coversAvailable() {
  return !!CDN || signingEnabled || fs.existsSync(COVERS_DIR);
}

/** Returns true if a cover file exists on disk for the given slug. */
export function coverOnDisk(slug) {
  const s = safeSlug(slug);
  if (!s) return false;
  return fs.existsSync(path.join(COVERS_DIR, s + '.jpg'));
}

// ---------------------------------------------------------------- R2 writes
//
// Uploads and deletes use the same AWS v4 scheme but sign the payload hash in
// the header (x-amz-content-sha256) rather than the query string, since there
// is no query string on a PUT or DELETE.

function encodeKey(key) {
  return key.split('/').map((seg) => paramEncode(seg)).join('/');
}

function signWrite(method, key, body) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const payloadHash = sha256hex(body || '');

  const canonicalRequest = [
    method,
    `/${paramEncode(BUCKET)}/${encodeKey(key)}`,
    '',
    `host:${host}\n`,
    'host',
    payloadHash,
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  const kDate = hmac('AWS4' + SECRET, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return {
    amzDate,
    payloadHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, SignedHeaders=host, Signature=${signature}`,
  };
}

/** Uploads a cover image to R2 at covers/<slug>.jpg. Throws if not configured. */
export async function uploadCover(slug, buffer, contentType) {
  const s = safeSlug(slug);
  if (!s) throw new Error('Invalid book slug.');
  if (!signingEnabled) throw new Error('R2 is not configured. Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT and R2_BUCKET.');

  const key = `covers/${s}.jpg`;
  const sig = signWrite('PUT', key, buffer);
  const res = await fetch(`${ENDPOINT}/${BUCKET}/${key}`, {
    method: 'PUT',
    headers: {
      'x-amz-date': sig.amzDate,
      'x-amz-content-sha256': sig.payloadHash,
      'Content-Type': contentType || 'image/jpeg',
      'Content-Length': String(buffer.length),
      Authorization: sig.authorization,
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`R2 upload failed (${res.status} ${res.statusText}).`);
  return key;
}

/** Removes a cover image from R2. Missing objects are not an error. */
export async function deleteCover(slug) {
  const s = safeSlug(slug);
  if (!s) throw new Error('Invalid book slug.');
  if (!signingEnabled) return null;

  const key = `covers/${s}.jpg`;
  const sig = signWrite('DELETE', key, '');
  const res = await fetch(`${ENDPOINT}/${BUCKET}/${key}`, {
    method: 'DELETE',
    headers: {
      'x-amz-date': sig.amzDate,
      'x-amz-content-sha256': sig.payloadHash,
      Authorization: sig.authorization,
    },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 delete failed (${res.status} ${res.statusText}).`);
  }
  return key;
}

export { CDN as CDN_URL, COVERS_DIR, signingEnabled as r2Configured };
