// Uploads cover images to Cloudflare R2.
//
// Usage:
//   node tools/covers/upload-covers.mjs          # dry-run: list what would upload
//   node tools/covers/upload-covers.mjs --upload # actually upload to R2
//   node tools/covers/upload-covers.mjs --clean  # delete test objects
//
// Reads R2 env from .env (same as src/audio.js presign):
//   R2_ACCOUNT_ID, R2_BUCKET, R2_ENDPOINT,
//   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
//
// Covers are stored as R2 objects at covers/<slug>.jpg (public read).
// After upload, they are served via presigned URLs (src/cover.js) or
// directly from COVER_CDN_URL when a public domain is configured.

import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';

const OUT = path.join(process.cwd(), 'covers');
const PROV = path.join(OUT, 'provenance.json');

const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
}

const KEY = process.env.R2_ACCESS_KEY_ID || '';
const SECRET = process.env.R2_SECRET_ACCESS_KEY || '';
const ENDPOINT = (process.env.R2_ENDPOINT || '').replace(/\/+$/, '');
const BUCKET = process.env.R2_BUCKET || '';
const REGION = 'auto';

if (!KEY || !SECRET || !ENDPOINT || !BUCKET) {
  console.error('R2 credentials not found in .env (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET required)');
  process.exit(1);
}

const host = ENDPOINT.replace(/^https?:\/\//, '');
const sha256hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key, s) => createHmac('sha256', key).update(s, 'utf8').digest();

function paramEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function sigHeaders(method, key, body) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const payloadHash = sha256hex(body || '');

  const canonicalRequest = [
    method,
    `/${BUCKET}/${key}`,
    '',
    `host:${host}\n`,
    'host',
    payloadHash,
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

  const authHeader = `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, SignedHeaders=host, Signature=${signature}`;
  return { authHeader, amzDate, payloadHash };
}

async function uploadObject(key, body, contentType) {
  const sig = sigHeaders('PUT', key, body);
  const url = `${ENDPOINT}/${BUCKET}/${key}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'x-amz-date': sig.amzDate,
      'x-amz-content-sha256': sig.payloadHash,
      'Content-Type': contentType,
      'Authorization': sig.authHeader,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Upload ${key}: ${res.status} ${res.statusText}`);
  }
}

async function deleteObject(key) {
  const sig = sigHeaders('DELETE', key, '');
  const url = `${ENDPOINT}/${BUCKET}/${key}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'x-amz-date': sig.amzDate,
      'x-amz-content-sha256': sig.payloadHash,
      'Authorization': sig.authHeader,
    },
  });
  if (!res.ok) {
    throw new Error(`Delete ${key}: ${res.status} ${res.statusText}`);
  }
}

const doUpload = process.argv.includes('--upload');
const doClean = process.argv.includes('--clean');

if (doClean) {
  try {
    await deleteObject('covers/test.txt');
    console.log('Deleted covers/test.txt');
  } catch (e) {
    console.log('Delete failed:', e.message);
  }
  process.exit(0);
}

const prov = JSON.parse(fs.readFileSync(PROV, 'utf8'));
const toUpload = [];
for (const [slug, entry] of Object.entries(prov)) {
  if (!entry.found) continue;
  if (!entry.file) continue;
  const filePath = path.join(OUT, entry.file);
  if (!fs.existsSync(filePath)) {
    console.warn('WARN: cover file missing for', slug, '-', entry.file);
    continue;
  }
  toUpload.push({ slug, entry, filePath });
}

console.log('Found', toUpload.length, 'covers to upload');
console.log(doUpload ? 'Uploading to R2...' : 'DRY RUN (add --upload to upload)');
console.log();

for (const { slug, entry, filePath } of toUpload) {
  const buf = fs.readFileSync(filePath);
  const key = `covers/${slug}.jpg`;

  if (doUpload) {
    try {
      await uploadObject(key, buf, 'image/jpeg');
      console.log('  OK  ' + (buf.length/1024).toFixed(0) + 'KB  ' + slug + ' -> ' + key);
    } catch (e) {
      console.log('  ERR ' + slug + ': ' + e.message);
    }
  } else {
    console.log('  WOULD ' + (buf.length/1024).toFixed(0) + 'KB  ' + slug + ' -> ' + key);
  }
}

if (doUpload) {
  console.log();
  console.log('Done. Covers are served via presigned URLs at /covers/<slug>.jpg');
}
