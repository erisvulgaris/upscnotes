// Verifies the quiz pager: DOM stays small, more loads on demand, filters work.
const BASE = "http://localhost:4177";
const page = await browser.getPage("qp");
const fails = [];
function fail(m) { fails.push(m); console.log("FAIL  " + m); }
function pass(m) { console.log("PASS  " + m); }

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(BASE + "/dashboard", { waitUntil: "load" });
if (/\/login/.test(page.url())) {
  await page.fill('input[name="email"]', "admin@upscbooks.in");
  await page.fill('input[name="password"]', "admin12345");
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click('button[type="submit"]')]);
}
await page.goto(BASE + "/book/modern-indian-history/quiz", { waitUntil: "load", timeout: 25000 });
await page.waitForTimeout(1500);

let s = await page.evaluate(() => ({
  cards: document.querySelectorAll(".qcard").length,
  count: (document.getElementById("q-count") || {}).textContent,
  pager: !!document.querySelector(".ex-pager"),
  moreLabel: (document.querySelector(".ex-pager + .btn") || {}).textContent,
  domNodes: document.getElementsByTagName("*").length,
  pageH: Math.round(document.documentElement.scrollHeight),
}));
console.log("  initial: " + JSON.stringify(s));
if (s.cards > 60) fail("quiz rendered " + s.cards + " cards at once (expected a first page)");
else pass("quiz first page is " + s.cards + " cards, DOM " + s.domNodes + " nodes");
if (!/1,213 questions/.test(s.count || "")) fail("count text unexpected: " + s.count);

// Load more
const before = s.cards;
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(1200);
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(1200);
s = await page.evaluate(() => ({ cards: document.querySelectorAll(".qcard").length, nodes: document.getElementsByTagName("*").length }));
console.log("  after scrolling: " + JSON.stringify(s));
if (s.cards <= before) fail("scrolling did not load more cards (" + before + " -> " + s.cards + ")");
else pass("infinite load " + before + " -> " + s.cards + " cards");

// Filter narrows
await page.fill("#q-search", "Mughal");
await page.waitForTimeout(700);
s = await page.evaluate(() => ({
  cards: document.querySelectorAll(".qcard").length,
  count: (document.getElementById("q-count") || {}).textContent,
}));
console.log("  filtered: " + JSON.stringify(s));
if (!(s.cards > 0 && s.cards < 200)) fail("search filter did not narrow to a small set (" + s.cards + ")");
else pass("filter narrows to " + s.cards + " (" + s.count + ")");

// Filter to nothing
await page.fill("#q-search", "zzzqqqxyz");
await page.waitForTimeout(700);
s = await page.evaluate(() => ({
  cards: document.querySelectorAll(".qcard").length,
  empty: document.querySelectorAll(".ex-empty").length,
  msg: (document.querySelector(".ex-empty") || {}).textContent,
}));
console.log("  no-match: " + JSON.stringify(s));
if (s.cards !== 0 || s.empty < 1) fail("no-match state missing");
else pass("no-match state: " + JSON.stringify(s.msg));

// Reset
await page.fill("#q-search", "");
await page.waitForTimeout(700);
s = await page.evaluate(() => document.querySelectorAll(".qcard").length);
if (s < 10) fail("clearing the filter did not repopulate (" + s + ")");
else pass("clearing the filter repopulates to " + s);

const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (over > 1) fail("h-overflow " + over);
else pass("no horizontal overflow");

console.log("");
console.log("TOTAL FAILURES: " + fails.length);
fails.forEach((f) => console.log("  - " + f));