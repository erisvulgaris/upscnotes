import fs from 'node:fs';
import path from 'node:path';

// Exercise the audio routes end to end, including the Range path the player
// uses to seek. Powershell's Invoke-WebRequest refuses to send Range, so this
// does it properly.
const BASE = 'http://localhost:4177';

// The session cookie is handed in from the shell (PowerShell's
// Invoke-WebRequest handles the login + CSRF dance reliably).
const jar = [];
function cookieHeader() {
  const extra = process.env.UPSC_COOKIE || '';
  return jar.concat(extra ? [extra] : []).join('; ');
}
function absorb(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  set.forEach((c) => jar.push(c.split(';')[0]));
}

let r = await fetch(BASE + '/dashboard', { headers: { cookie: cookieHeader() } });
absorb(r);
console.log('session ->', r.status, new URL(r.url).pathname);
if (new URL(r.url).pathname === '/login') {
  console.log('no session cookie supplied — run through the wrapper that logs in first');
  process.exit(1);
}

// Manifest
r = await fetch(BASE + '/audio/manifest.json', { headers: { cookie: cookieHeader() } });
const man = await r.json();
const slugs = Object.keys(man.books || {});
console.log('manifest', r.status, 'source=' + man.source, 'books=' + slugs.length);
if (!slugs.length) { console.log('NO AUDIO YET'); process.exit(0); }

// Pick a chapter that is comfortably long.
let pick = null;
for (const s of slugs) {
  for (const [n, m] of Object.entries(man.books[s])) {
    if ((m.duration || 0) > 120) { pick = { s, n, m }; break; }
  }
  if (pick) break;
}
console.log('picking', pick.s, 'ch' + pick.n, pick.m.duration + 's', pick.m.sentences + ' sentences');

// Full request
r = await fetch(`${BASE}/audio/${pick.s}/${pick.n}.opus`, { headers: { cookie: cookieHeader() } });
const buf = Buffer.from(await r.arrayBuffer());
console.log('full  ', r.status, r.headers.get('content-type'), buf.length + 'B',
  'accept-ranges=' + r.headers.get('accept-ranges'), 'got=' + buf.length + 'B');

// Range request (what seeking does)
r = await fetch(`${BASE}/audio/${pick.s}/${pick.n}.opus`, {
  headers: { cookie: cookieHeader(), range: 'bytes=1000-3999' },
});
const part = Buffer.from(await r.arrayBuffer());
console.log('range ', r.status, r.headers.get('content-range'), part.length + 'B',
  part.length === 3000 ? 'OK' : 'MISMATCH');

// Timings
r = await fetch(`${BASE}/audio/${pick.s}/${pick.n}.json`, { headers: { cookie: cookieHeader() } });
const t = await r.json();
console.log('timings', r.status, 'duration=' + t.duration, 'sentences=' + t.sentenceTimings.length,
  'url=' + t.url);
const first = t.sentenceTimings[0];
const last = t.sentenceTimings[t.sentenceTimings.length - 1];
console.log('  first t=' + first.t + ' "' + first.text.slice(0, 50) + '"');
console.log('  last  t=' + last.t + ' "' + last.text.slice(0, 50) + '"');
// Timings must be monotonic and fit inside the duration.
let mono = true;
for (let i = 1; i < t.sentenceTimings.length; i++) {
  if (t.sentenceTimings[i].t < t.sentenceTimings[i - 1].t) { mono = false; break; }
}
console.log('  monotonic=' + mono + ' withinDuration=' + (last.t <= t.duration + 1));

// Path traversal must not escape.
for (const bad of ['..%2F..%2Fpackage', '..', 'x'.repeat(200)]) {
  r = await fetch(`${BASE}/audio/${bad}/1.opus`, { headers: { cookie: cookieHeader() } });
  console.log('traversal "' + bad.slice(0, 18) + '" ->', r.status);
}
// Unauthenticated must be refused.
r = await fetch(`${BASE}/audio/${pick.s}/${pick.n}.opus`);
console.log('anonymous ->', r.status);
r = await fetch(`${BASE}/audio/manifest.json`);
console.log('anonymous manifest ->', r.status);

// Opus file header sanity (OggS magic)
const first4 = buf.slice(0, 4).toString('latin1');
console.log('container=' + first4 + (first4 === 'OggS' ? ' OK' : ' BAD'));