// Regression guard for the `.stack` collision: the hero's cover fan was
// briefly named `.stack`, which overrode the global `.stack` layout utility
// (display: grid) with display: flex and silently turned every form and band
// that used it into a row. This asserts the two are now distinct and that
// `.stack` is still a grid everywhere it is used.
const BASE = 'http://localhost:4177';
const page = await browser.getPage('stk');
const fails = [];
function fail(m) { fails.push(m); console.log('FAIL  ' + m); }
function pass(m) { console.log('PASS  ' + m); }

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(BASE + '/login', { waitUntil: 'load' });
if (/\/login/.test(page.url())) {
  await page.fill('input[name="email"]', 'admin@upscbooks.in');
  await page.fill('input[name="password"]', 'admin12345');
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('button[type="submit"]')]);
}

const PAGES = ['/', '/login', '/signup', '/checkout', '/admin/pricing'];

for (const route of PAGES) {
  await page.goto(BASE + route, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(400);

  const m = await page.evaluate(() => {
    const stacks = [...document.querySelectorAll('.stack')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        display: getComputedStyle(el).display,
        w: Math.round(r.width),
        children: el.children.length,
        // A grid stacks; a flex row puts children side by side.
        stacked: el.children.length < 2 ||
          [...el.children].every((c, i, a) => i === 0 || c.getBoundingClientRect().top >= a[i - 1].getBoundingClientRect().top - 2),
      };
    });
    return {
      stacks,
      fans: document.querySelectorAll('.fan-book').length,
      stackBooks: document.querySelectorAll('.stack-book').length,
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  const wrong = m.stacks.filter((s) => s.display !== 'grid');
  if (wrong.length) {
    fail(route + ': ' + wrong.length + ' .stack element(s) are ' + wrong.map((w) => w.display).join(', ') + ', not grid');
  } else if (m.stacks.length) {
    pass(route + ': ' + m.stacks.length + ' .stack element(s) all display:grid');
  } else {
    pass(route + ': no .stack on this page');
  }
  if (m.stackBooks > 0) fail(route + ': stale .stack-book class still present');
  if (m.over > 1) fail(route + ': overflow ' + m.over);
}

// The fan must still be a fan.
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForTimeout(500);
const fan = await page.evaluate(() => {
  const f = document.querySelector('.fan');
  const books = [...document.querySelectorAll('.fan-book')];
  if (!f) return { present: false };
  const fr = f.getBoundingClientRect();
  const widths = books.map((b) => Math.round(b.getBoundingClientRect().width));
  return {
    present: true,
    display: getComputedStyle(f).display,
    count: books.length,
    leadWidest: widths[0] === Math.max(...widths),
    insideFan: books.every((b) => {
      const r = b.getBoundingClientRect();
      // Covers are rotated, and a transform does not change layout: a rotated
      // cover's bounding box is legitimately wider than the box it occupies.
      // Allow for the rotation rather than pretending it is an overflow.
      return r.left >= fr.left - 30 && r.right <= fr.right + 30;
    }),
  };
});
if (!fan.present) fail('the hero fan is gone');
else if (fan.display !== 'flex') fail('.fan is ' + fan.display + ', expected flex');
else if (!fan.leadWidest) fail('the lead cover is not the widest');
else if (!fan.insideFan) fail('a cover escapes the fan bounds');
else pass('fan: ' + fan.count + ' covers, flex, lead widest, all inside bounds');

console.log('');
console.log('TOTAL FAILURES: ' + fails.length);
fails.forEach((f) => console.log('  - ' + f));