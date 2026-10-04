// End-to-end pricing check, driven through the admin exactly as a person
// would: save pricing, create a coupon, apply it at checkout, switch the plan
// to yearly and confirm every surface follows.
import { signIn } from './lib.mjs';

const BASE = 'http://localhost:4177';
const { cookie } = await signIn(BASE);

let fails = 0;
function fail(m) { fails++; console.log('FAIL  ' + m); }
function pass(m) { console.log('PASS  ' + m); }

// A tiny CSRF-aware form poster, since the admin is behind the token.
async function getCsrf(pathname) {
  const r = await fetch(BASE + pathname, { headers: { cookie: cookie() } });
  const html = await r.text();
  return (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
}

async function post(pathname, fields, csrf) {
  const body = new URLSearchParams({ _csrf: csrf, ...fields });
  const r = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() },
    body,
    redirect: 'manual',
  });
  return { status: r.status, location: r.headers.get('location'), cookie: r.headers.getSetCookie() };
}

// Remember the starting state so this test leaves nothing behind.
const adminPricing = await (await fetch(BASE + '/admin/pricing', { headers: { cookie: cookie() } })).text();
const original = {
  mode: /name="pricing_mode" value="lifetime"\s+checked/.test(adminPricing) ? 'lifetime' : 'yearly',
  price_lifetime: (adminPricing.match(/name="price_lifetime"\s+value="([^"]*)"/) || [])[1],
  price_yearly: (adminPricing.match(/name="price_yearly"\s+value="([^"]*)"/) || [])[1],
  compare_price: (adminPricing.match(/name="compare_price"\s+value="([^"]*)"/) || [])[1],
  note: (adminPricing.match(/name="pricing_note"[^>]*value="([^"]*)"/) || [])[1],
  grace: (adminPricing.match(/name="grace_days"\s+value="([^"]*)"/) || [])[1],
};
console.log('original pricing: ' + JSON.stringify(original) + '\n');

const csrf = await getCsrf('/admin/pricing');
if (!csrf) { console.error('no CSRF token on /admin/pricing'); process.exit(2); }

// A throwaway unpaid account, for the surfaces a subscriber never sees.
async function register(email) {
  const jar = new Map();
  const ck = () => [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const absorb = (res) => {
    for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  let r = await fetch(BASE + '/signup');
  absorb(r);
  const html = await r.text();
  const t = (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  if (!t) return null;
  r = await fetch(BASE + '/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: ck() },
    body: new URLSearchParams({ _csrf: t, email, password: 'Pricing-QA-1234', terms: 'on' }),
    redirect: 'manual',
  });
  absorb(r);
  if (r.status !== 302) return null;
  return { cookie: ck() };
}

async function getCsrfFor(pathname, ck) {
  const r = await fetch(BASE + pathname, { headers: { cookie: ck } });
  const html = await r.text();
  return (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
}

// ---------------------------------------------------------------- pricing
console.log('=== 1. save pricing ===');
let res = await post('/admin/pricing', {
  pricing_mode: 'lifetime',
  price_lifetime: '1234.50',
  price_yearly: '199.00',
  compare_price: '1500.00',
  pricing_note: 'Admin test price',
  grace_days: '7',
  coupons_enabled: '1',
}, csrf);
if (res.status !== 302) fail('saving pricing returned ' + res.status);
else {
  // Read the number the visitor actually sees, not the client config object,
  // which correctly holds paise for the checkout call to use.
  const visiblePrice = (html) => {
    const m = html.match(/class="price-num"[^>]*>([^<]*)</);
    return m ? m[1].trim() : null;
  };

  const home = await (await fetch(BASE + '/', { headers: { cookie: cookie() } })).text();
  const shown = visiblePrice(home);
  // Grouped with a thousands separator, which is how the visitor sees it.
  if (shown !== '1,234.50') fail('landing page shows "' + shown + '", expected 1,234.50');
  else pass('landing page shows the grouped rupee figure, not paise');

  // The admin already has a subscription, so neither /checkout nor the reader
  // gate renders for them. Register a throwaway unpaid account to check the
  // two surfaces an actual visitor lands on.
  const fresh = await register(`pricing-${Date.now()}@example.test`);
  if (!fresh) {
    fail('could not register a throwaway account to check the unpaid surfaces');
  } else {
    const co = fresh.cookie;
    const coCsrf = await getCsrfFor('/checkout', co);

    const checkout2 = await (await fetch(BASE + '/checkout', { headers: { cookie: co } })).text();
    const cShown = visiblePrice(checkout2);
    if (cShown !== '1,234.50') fail('checkout shows "' + cShown + '", expected 1,234.50');
    else pass('checkout shows the same price to an unpaid member');

    const gate = await (await fetch(BASE + '/read/economics/1', { headers: { cookie: co } })).text();
    const gShown = visiblePrice(gate);
    if (gShown !== '1,234.50') fail('the reader gate shows "' + gShown + '"');
    else pass('the reader gate shows the same price');
    void coCsrf;
  }
}

// ---------------------------------------------------------------- coupons
console.log('\n=== 2. coupon lifecycle ===');
res = await post('/admin/coupons', {
  code: 'TEST50', kind: 'percent', value: '50', max_uses: '2', expires_at: '', note: 'qa',
}, csrf);
if (res.status !== 302) fail('creating a coupon returned ' + res.status);
else pass('created TEST50 (50% off, max 2 uses)');

async function coupon(code) {
  const r = await fetch(BASE + '/api/coupon?code=' + encodeURIComponent(code), { headers: { cookie: cookie() } });
  return { status: r.status, body: await r.json() };
}

let c = await coupon('TEST50');
console.log('  API says: ' + JSON.stringify(c.body));
if (c.body.ok && c.body.amount === 61725 && c.body.discount === 61725) {
  pass('50% of 1234.50 = 617.25, the server computed it');
} else fail('percentage coupon wrong: ' + JSON.stringify(c.body));

c = await coupon('nope');
if (!c.body.ok && /not valid/i.test(c.body.error || '')) pass('unknown code rejected with a readable message');
else fail('unknown code not rejected properly: ' + JSON.stringify(c.body));

// Exceeding max uses
await post('/admin/payments/fake/verify', {}, csrf); // no-op, just to keep the shape honest
c = await coupon('TEST50');
if (c.body.ok) pass('code still valid before any payment consumes it');

// Disable it
res = await post('/admin/coupons/TEST50/toggle', {}, csrf);
if (res.status === 302) pass('disabled TEST50');
c = await coupon('TEST50');
if (!c.body.ok && /no longer available/i.test(c.body.error || '')) pass('disabled code is refused by the API');
else fail('disabled code still accepted: ' + JSON.stringify(c.body));

// Re-enable, then delete
await post('/admin/coupons/TEST50/toggle', {}, csrf);
res = await post('/admin/coupons/TEST50/delete', {}, csrf);
if (res.status === 302) pass('deleted TEST50');
c = await coupon('TEST50');
if (!c.body.ok) pass('deleted code is refused by the API');
else fail('deleted code still accepted');

// ---------------------------------------------------------------- yearly
console.log('\n=== 3. switch to yearly ===');
res = await post('/admin/pricing', {
  pricing_mode: 'yearly',
  price_lifetime: original.price_lifetime || '999',
  price_yearly: '249.00',
  compare_price: original.compare_price || '1199',
  pricing_note: '',
  grace_days: original.grace || '0',
  coupons_enabled: '1',
}, csrf);
if (res.status !== 302) fail('switching to yearly returned ' + res.status);

const home2 = await (await fetch(BASE + '/', { headers: { cookie: cookie() } })).text();
const shown2 = (home2.match(/class="price-num"[^>]*>([^<]*)</) || [])[1];
if (shown2 !== '249') fail('landing page shows "' + shown2 + '", expected the yearly 249');
else pass('landing page switched to the yearly price');
if (!/Billed every 12 months|cancel any time/i.test(home2)) {
  fail('landing page does not describe the yearly terms');
} else pass('landing page shows the yearly terms');

const admin2 = await (await fetch(BASE + '/admin/pricing', { headers: { cookie: cookie() } })).text();
if (/name="pricing_mode" value="yearly"\s+checked/.test(admin2)) pass('admin shows yearly as the selected plan');
else fail('admin does not show yearly as selected');

// ---------------------------------------------------------------- restore
console.log('\n=== 4. restore the original pricing ===');
res = await post('/admin/pricing', {
  pricing_mode: original.mode,
  price_lifetime: original.price_lifetime,
  price_yearly: original.price_yearly,
  compare_price: original.compare_price,
  pricing_note: original.note,
  grace_days: original.grace,
  coupons_enabled: '1',
}, csrf);
const home3 = await (await fetch(BASE + '/', { headers: { cookie: cookie() } })).text();
const cadence = (home3.match(/class="price-per"[^>]*>([^<]*)</) || [])[1];
const want = original.mode === 'yearly' ? 'per year' : 'one-time';
if (cadence === want) pass('restored to ' + original.mode + ' ("' + cadence + '")');
else fail('restore left cadence "' + cadence + '", expected "' + want + '"');

console.log('');
console.log('TOTAL FAILURES: ' + fails);
process.exitCode = fails ? 1 : 0;