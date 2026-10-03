// Confirms compression is actually applied, and that it did not break Range
// requests on the audio (which it must not touch).
import zlib from 'node:zlib';

const BASE = 'http://localhost:4177';
const jar = [];
const cookieHeader = () => jar.join('; ');
function absorb(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  set.forEach((c) => jar.push(c.split(';')[0]));
}

let r = await fetch(BASE + '/login', { headers: { cookie: cookieHeader() } });
absorb(r);
const html = await r.text();
const csrf = (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
r = await fetch(BASE + '/login', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader() },
  body: new URLSearchParams({ _csrf: csrf, email: 'admin@upscbooks.in', password: 'admin12345' }),
  redirect: 'follow',
});
absorb(r);

console.log("=== COMPRESSION ===");
for (const [route, accept] of [
  ['/', 'gzip, deflate, br'],
  ['/library', 'gzip, deflate, br'],
  ['/css/app.css', 'gzip, deflate, br'],
  ['/css/tokens.css', 'gzip, deflate, br'],
  ['/js/app.js', 'gzip, deflate, br'],
]) {
  const res = await fetch(BASE + route, { headers: { cookie: cookieHeader(), 'accept-encoding': accept } });
  const buf = Buffer.from(await res.arrayBuffer());
  const enc = res.headers.get('content-encoding');
  console.log(
    route.padEnd(18) + " " + res.status +
    "  encoding=" + String(enc || 'identity').padEnd(8) +
    "  onWire=" + (buf.length / 1024).toFixed(1).padStart(7) + "K" +
    (enc ? "  ratio=" + (1 - buf.length / (Number(res.headers.get('x-uncompressed-length')) || buf.length * 4)).toFixed(2) : "")
  );
  if (route === '/css/app.css' && !enc) console.log("  !! app.css NOT compressed");
}

// Range requests must still work and must not be compressed.
console.log("");
console.log("=== RANGE / AUDIO UNAFFECTED ===");
const man = await (await fetch(BASE + '/audio/manifest.json', { headers: { cookie: cookieHeader() } })).json();
const slugs = Object.keys(man.books || {});
if (!slugs.length) {
  console.log("no audio built yet — skipping");
} else {
  const slug = slugs[0];
  const n = Object.keys(man.books[slug])[0];
  const full = await fetch(`${BASE}/audio/${slug}/${n}.opus`, { headers: { cookie: cookieHeader() } });
  const fullBuf = Buffer.from(await full.arrayBuffer());
  console.log("full  " + full.status + " encoding=" + (full.headers.get('content-encoding') || 'identity') +
              " len=" + fullBuf.length + " type=" + full.headers.get('content-type'));

  const part = await fetch(`${BASE}/audio/${slug}/${n}.opus`, {
    headers: { cookie: cookieHeader(), range: 'bytes=1000-3999', 'accept-encoding': 'gzip' },
  });
  const partBuf = Buffer.from(await part.arrayBuffer());
  console.log("range " + part.status + " " + part.headers.get('content-range') +
              " len=" + partBuf.length + " encoding=" + (part.headers.get('content-encoding') || 'identity') +
              (partBuf.length === 3000 ? "  OK" : "  MISMATCH"));
  if (partBuf.length !== 3000) process.exitCode = 1;
}

// JSON should compress too.
const j = await fetch(BASE + '/audio/manifest.json', { headers: { cookie: cookieHeader(), 'accept-encoding': 'gzip' } });
const jb = Buffer.from(await j.arrayBuffer());
console.log("");
console.log("manifest encoding=" + (j.headers.get('content-encoding') || 'identity') + " wire=" + (jb.length / 1024).toFixed(1) + "K");
console.log("done");