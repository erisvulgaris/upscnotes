// Yearly has to actually expire, or the admin switch is only cosmetic.
//
// Grants a yearly subscription that expires in the past and checks that
// reading is blocked, one that is still valid and checks it is not, and a
// lifetime grant which never expires. Uses a throwaway member so the admin's
// own subscription is untouched, and removes it afterwards.
import { DatabaseSync } from 'node:sqlite';
import { signIn } from '../lib.mjs';

const BASE = 'http://localhost:4177';
const db = new DatabaseSync('data/upscbooks.db');

let fails = 0;
function fail(m) { fails++; console.log('FAIL  ' + m); }
function pass(m) { console.log('PASS  ' + m); }

// Only needed so the admin's own session exists for later reads; the member
// below is created here.
await signIn(BASE);

const email = `yearly-${Date.now()}@example.test`;
const jar = new Map();
const ck = () => [...jar].map(([k, v]) => k + '=' + v).join('; ');
const absorb = (r) => {
  for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
    const [p] = c.split(';');
    const i = p.indexOf('=');
    if (i > 0) jar.set(p.slice(0, i), p.slice(i + 1));
  }
};

{
  let r = await fetch(BASE + '/signup');
  absorb(r);
  const t = ((await r.text()).match(/name="_csrf" value="([^"]+)"/) || [])[1];
  if (!t) { console.error('no CSRF token on /signup'); process.exit(2); }
  r = await fetch(BASE + '/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: ck() },
    body: new URLSearchParams({ _csrf: t, email, password: 'Yearly-QA-1234', terms: 'on' }),
    redirect: 'manual',
  });
  absorb(r);
  if (r.status !== 302) { console.error('could not register (status ' + r.status + ')'); process.exit(2); }
}

const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (!user) { console.error('user not created'); process.exit(2); }
console.log('member ' + email + ' id=' + user.id + '\n');

function grant(plan, expiresAt) {
  db.prepare(
    `INSERT INTO subscriptions (user_id, plan, status, price_paise, activated_at, expires_at, source)
     VALUES (?, ?, 'active', ?, datetime('now'), ?, 'admin')`
  ).run(user.id, plan, plan === 'yearly' ? 24900 : 99900, expiresAt);
}

async function canRead() {
  const r = await fetch(BASE + '/read/economics/1', { headers: { cookie: ck() }, redirect: 'manual' });
  const body = await r.text();
  return {
    status: r.status,
    blocked: r.status === 403 || body.indexOf('pricing-card') !== -1,
    hasReader: body.indexOf('class="tts-sent"') !== -1,
  };
}

try {
  let r = await canRead();
  if (r.blocked) pass('a new member is blocked from reading');
  else fail('a member with no subscription can read: ' + JSON.stringify(r));

  db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(user.id);
  const future = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
  grant('yearly', future);
  r = await canRead();
  if (!r.blocked && r.hasReader) pass('yearly with time left grants reading (expires ' + future + ')');
  else fail('a valid yearly subscription does not grant reading: ' + JSON.stringify(r));

  db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(user.id);
  const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  grant('yearly', past);
  r = await canRead();
  if (r.blocked) pass('an expired yearly subscription is blocked (expired ' + past + ')');
  else fail('an expired yearly subscription still grants reading: ' + JSON.stringify(r));

  db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(user.id);
  grant('lifetime', null);
  r = await canRead();
  if (!r.blocked && r.hasReader) pass('a lifetime subscription grants reading with no expiry');
  else fail('a lifetime subscription does not grant reading: ' + JSON.stringify(r));

  db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(user.id);
  grant('lifetime', past);
  r = await canRead();
  if (!r.blocked && r.hasReader) pass('a lifetime grant ignores a stale expiry date');
  else fail('lifetime wrongly honoured an expiry date');
} finally {
  db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  console.log('\n(throwaway account removed)');
}

console.log('');
console.log('TOTAL FAILURES: ' + fails);
process.exitCode = fails ? 1 : 0;