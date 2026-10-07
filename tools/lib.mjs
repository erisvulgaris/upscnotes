// Small shared helper for the Node-based checks: signs in once and returns a
// cookie header. Used by tools/check-sync.mjs and anything else that needs an
// authenticated session from plain Node.
import fs from 'node:fs';

export async function signIn(base = 'http://localhost:4177', email = 'admin@upscnotes.in', password = 'admin12345') {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const absorb = (res) => {
    for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };

  let res = await fetch(base + '/login');
  absorb(res);
  const html = await res.text();
  const csrf = (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  if (!csrf) throw new Error('no CSRF token on /login');

  res = await fetch(base + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() },
    body: new URLSearchParams({ _csrf: csrf, email, password }),
    // manual, not follow: the session id is regenerated on the 302, and a
    // followed redirect hides that response's Set-Cookie, leaving only the
    // stale pre-login one.
    redirect: 'manual',
  });
  absorb(res);
  if (res.status !== 302) {
    throw new Error('sign-in failed: expected 302, got ' + res.status);
  }

  res = await fetch(base + '/dashboard', { headers: { cookie: cookie() }, redirect: 'manual' });
  if (res.status === 302) throw new Error('sign-in failed: still redirected to ' + res.headers.get('location'));

  return { cookie, base };
}

// Normalises text for alignment: lowercase, alphanumerics and spaces only.
export function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ]+/g, ' ')
    .trim();
}

/**
 * Maps each highlighted sentence onto the audio sentence that begins it.
 *
 * The cached sidecars were produced from narrationText()'s chunking, while the
 * reader highlights whatever renderChapter emitted as `.tts-sent`. The two
 * lists are near-identical but not identical, so index i in the timings is not
 * necessarily the sentence being highlighted - which makes the audio say one
 * thing while another is lit up.
 *
 * Aligning by text at load time means the cached audio does not have to be
 * regenerated, and the alignment self-corrects if the content changes.
 * Returns an array of audio indices, one per highlighted sentence.
 */
export function alignSentences(domTexts, audioTexts, window = 8) {
  const map = [];
  let a = 0;
  let last = 0;
  for (let d = 0; d < domTexts.length; d++) {
    const nd = norm(domTexts[d]);
    if (!nd) { map.push(last); continue; }
    let found = -1;
    const end = Math.min(audioTexts.length, a + window);
    for (let k = a; k < end; k++) {
      if (norm(audioTexts[k]) === nd) { found = k; break; }
    }
    if (found < 0) {
      // One highlighted sentence can cover several audio chunks.
      for (let k = a; k < end; k++) {
        const na = norm(audioTexts[k]);
        if (na && (nd.startsWith(na) || na.startsWith(nd))) { found = k; break; }
      }
    }
    if (found < 0) { map.push(last); continue; }
    map.push(found);
    last = found;
    a = found + 1;
  }
  return map;
}

export function readSidecar(slug, chapter) {
  const p = `audio/${slug}/${chapter}.json`;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}