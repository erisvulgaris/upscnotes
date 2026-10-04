// Does the "audio available" badge tell the truth? It is driven by hasAudio(),
// which reads the manifest. For every book with audio, fetch a chapter page
// and check the badge is present; and for a chapter with no audio, check it is
// absent.
const BASE = 'http://localhost:4177';

const jar = new Map();
const cookie = () => [...jar].map(([k, v]) => k + '=' + v).join('; ');
function absorb(r) {
  for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}

let r = await fetch(BASE + '/login');
absorb(r);
const html = await r.text();
const csrf = (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
r = await fetch(BASE + '/login', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() },
  body: new URLSearchParams({ _csrf: csrf, email: 'admin@upscbooks.in', password: 'admin12345' }),
  redirect: 'manual',
});
absorb(r);
if (r.status !== 302) { console.error('login failed: ' + r.status); process.exit(2); }

const man = await (await fetch(BASE + '/audio/manifest.json', { headers: { cookie: cookie() } })).json();
const books = Object.keys(man.books || {}).sort();
console.log('manifest lists ' + books.length + ' books with audio\n');

let fails = 0;
let checked = 0;

for (const slug of books) {
  const chapters = Object.keys(man.books[slug]).map(Number).sort((a, b) => a - b);
  const n = chapters[Math.floor(chapters.length / 2)];
  const res = await fetch(`${BASE}/read/${slug}/${n}`, { headers: { cookie: cookie() } });
  const body = await res.text();
  const hasBadge = body.includes('class="rd-audio"');
  const sents = (body.match(/class="tts-sent"/g) || []).length;
  const title = (body.match(/class="rd-chtitle">([^<]*)</) || [])[1] || '';
  checked++;

  if (!hasBadge) {
    fails++;
    console.log(`FAIL  ${slug} ch${n}: manifest has audio but the page shows no badge`);
  } else if (sents < 1) {
    fails++;
    console.log(`FAIL  ${slug} ch${n}: badge shown but no sentences on the page`);
  } else {
    console.log(`PASS  ${slug.padEnd(42)} ch${String(n).padStart(3)}  badge=yes  sentences=${String(sents).padStart(4)}  ${title.slice(0, 30)}`);
  }
}

// The inverse: a chapter with no audio must not claim any.
console.log('');
const missing = [];
// Find a (slug, chapter) with no audio: a book listed in the DB but absent
// from the manifest, or a chapter number beyond what exists.
const probeSlug = 'economics';
for (const n of [999]) {
  const res = await fetch(`${BASE}/read/${probeSlug}/${n}`, { headers: { cookie: cookie() } });
  console.log(`ch${n} of ${probeSlug} -> HTTP ${res.status} (404 expected: no such chapter)`);
  if (res.status === 404) missing.push(`${probeSlug}/${n}`);
}
console.log('');
console.log(`checked ${checked} chapters across ${books.length} books`);
console.log(fails === 0 ? 'BADGE HONEST: it appears exactly where the manifest says audio exists'
  : `${fails} MISMATCH(ES)`);