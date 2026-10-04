// Direct HTTP checks that do not depend on browser session state:
//   - status codes for unknown routes
//   - the gated reader redirect
//   - that ?next= cannot be used as an open redirect
const BASE = 'http://localhost:4177';
let fails = 0;
function fail(m) { fails++; console.log('FAIL  ' + m); }
function pass(m) { console.log('PASS  ' + m); }

async function statusOf(path, cookie) {
  const r = await fetch(BASE + path, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location') };
}

// Sign in so existence checks are not masked by the auth redirect.
const sessionJar = [];
async function signIn() {
  const page = await fetch(BASE + '/login');
  (page.headers.getSetCookie ? page.headers.getSetCookie() : []).forEach((c) => sessionJar.push(c.split(';')[0]));
  const html = await page.text();
  const csrf = (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  const r = await fetch(BASE + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: sessionJar.join('; ') },
    body: new URLSearchParams({ _csrf: csrf, email: 'admin@upscbooks.in', password: 'admin12345' }),
    redirect: 'manual',
  });
  // The session id is regenerated on login, so the POST response carries the
  // cookie that actually matters. Take every cookie it sets: the name is
  // `upscbooks.sid`, not a framework default.
  const fresh = (r.headers.getSetCookie ? r.headers.getSetCookie() : [])
    .map((c) => c.split(';')[0])
    .filter(Boolean);
  if (r.status !== 302) {
    console.error('login did not succeed: status ' + r.status +
      (r.status === 403 ? ' (CSRF rejected — the pre-login cookie must be sent)' : ''));
    process.exit(2);
  }
  sessionJar.length = 0;
  sessionJar.push(...fresh);
  return sessionJar.join('; ');
}
const authCookie = await signIn();
console.log('signed in');
console.log('');

// --- unknown routes, anonymous: no route may leak a 500
for (const p of ['/nope', '/library/nope', '/css/does-not-exist.css', '/js/nope.js', '/img/nope.svg']) {
  const r = await statusOf(p);
  const ok = r.status === 404;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + p.padEnd(24) + ' -> ' + r.status + (r.location ? ' -> ' + r.location : ''));
  if (!ok) fails++;
}

// --- unknown book, authenticated. requireAuth runs first, so anonymously these
// redirect to /login; that is deliberate and is asserted separately below.
console.log('');
for (const p of ['/read/nope/1', '/book/nope']) {
  const anon = await statusOf(p);
  const authed = await statusOf(p, authCookie);
  const anonOk = anon.status === 302 && /^\/login\?next=/.test(anon.location || '');
  const authOk = authed.status === 404;
  console.log((anonOk && authOk ? 'PASS  ' : 'FAIL  ') + p.padEnd(24) +
    ' anonymous=' + anon.status + ' (redirects, does not leak existence)' +
    '  signed-in=' + authed.status);
  if (!anonOk) fail(p + ' anonymous -> ' + anon.status + ' ' + anon.location);
  if (!authOk) fail(p + ' signed-in -> ' + authed.status + ' (want 404)');
}

// --- anonymous hitting a gated reader
const gated = await statusOf('/read/modern-indian-history/1');
if (gated.status === 302 && /^\/login\?next=%2Fread%2F/.test(gated.location || '')) {
  pass('anonymous reader -> 302 ' + gated.location);
} else {
  fail('anonymous reader -> ' + gated.status + ' ' + gated.location);
}
const gated2 = await statusOf('/dashboard');
if (gated2.status === 302 && /^\/login\?next=/.test(gated2.location || '')) pass('anonymous dashboard -> 302 ' + gated2.location);
else fail('anonymous dashboard -> ' + gated2.status + ' ' + gated2.location);

// --- log in with a hostile ?next
async function loginWithNext(next) {
  const jar = [];
  let page = await fetch(BASE + '/login', { headers: {} });
  const setA = page.headers.getSetCookie ? page.headers.getSetCookie() : [];
  setA.forEach((c) => jar.push(c.split(';')[0]));
  const html = await page.text();
  const csrf = (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  const body = new URLSearchParams({ _csrf: csrf, email: 'admin@upscbooks.in', password: 'admin12345' });
  if (next !== undefined) body.set('next', next);
  const r = await fetch(BASE + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.join('; ') },
    body,
    redirect: 'manual',
  });
  return { status: r.status, location: r.headers.get('location') };
}

const ATTACKS = [
  ['//evil.example.com/x', 'protocol-relative'],
  ['https://evil.example.com/x', 'absolute'],
  ['http://evil.example.com/x', 'absolute http'],
  ['/\\evil.example.com', 'backslash'],
  ['javascript:alert(1)', 'javascript scheme'],
  ['/dashboard?a=1', 'legitimate same-site'],
  ['/library', 'legitimate path'],
];

for (const [next, label] of ATTACKS) {
  const r = await loginWithNext(next);
  const loc = r.location || '';
  const escaped = /evil\.example\.com|javascript:/i.test(loc);
  if (escaped) fail('open redirect via ' + label + ' -> ' + loc);
  else pass('next=' + JSON.stringify(next) + ' (' + label + ') -> ' + (loc || r.status));
}

console.log('');
console.log('TOTAL FAILURES: ' + fails);
process.exitCode = fails ? 1 : 0;