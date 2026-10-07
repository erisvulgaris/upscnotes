// Mains bank + maps: do the search/filter controls actually work?
const BASE = "http://localhost:4177";
const page = await browser.getPage("mn");
const fails = [];
function fail(m) { fails.push(m); console.log("FAIL  " + m); }
function pass(m) { console.log("PASS  " + m); }

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(BASE + "/dashboard", { waitUntil: "load" });
if (/\/login/.test(page.url())) {
  await page.fill('input[name="email"]', "admin@upscnotes.in");
  await page.fill('input[name="password"]', "admin12345");
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click('button[type="submit"]')]);
}

// --- mains bank
await page.goto(BASE + "/book/modern-indian-history/mains", { waitUntil: "load", timeout: 25000 });
await page.waitForTimeout(1500);
let m = await page.evaluate(() => ({
  cards: document.querySelectorAll(".mains-card").length,
  count: (document.getElementById("mains-count") || {}).textContent,
  hasSearch: !!document.getElementById("mains-q"),
  hasCh: !!document.getElementById("mains-ch"),
}));
console.log("  mains initial: " + JSON.stringify(m));
if (!m.hasSearch || !m.hasCh) fail("mains bank has no search or chapter filter");
if (m.cards < 1) fail("mains bank rendered nothing");
else pass("mains bank renders " + m.cards + " prompts with search + chapter filter");

await page.fill("#mains-q", "Plassey");
await page.waitForTimeout(600);
m = await page.evaluate(() => ({
  cards: document.querySelectorAll(".mains-card").length,
  count: (document.getElementById("mains-count") || {}).textContent,
}));
console.log("  mains 'Plassey': " + JSON.stringify(m));
if (!(m.cards > 0 && m.cards < 80)) fail("mains search did not narrow: " + m.cards);
else pass("mains search narrows to " + m.cards);

await page.fill("#mains-q", "zzzqqq");
await page.waitForTimeout(600);
m = await page.evaluate(() => ({ cards: document.querySelectorAll(".mains-card").length, empty: document.querySelectorAll(".ex-empty").length }));
if (m.cards !== 0 || !m.empty) fail("mains no-match state missing");
else pass("mains no-match state shown");

await page.fill("#mains-q", "");
await page.waitForTimeout(500);
const opts = await page.evaluate(() => document.querySelectorAll("#mains-ch option").length);
if (opts < 5) fail("mains chapter filter has too few options: " + opts);
else pass("mains chapter filter has " + (opts - 1) + " chapters");

// Expanding a card must reveal linked chapters.
await page.click(".mains-card summary");
await page.waitForTimeout(300);
const opened = await page.evaluate(() => {
  const d = document.querySelector(".mains-card[open]");
  return d ? d.querySelectorAll(".mains-items a").length : -1;
});
if (opened < 0) fail("mains card did not expand");
else pass("mains card expands (" + opened + " chapter links)");

// --- maps
await page.goto(BASE + "/book/modern-indian-history/maps", { waitUntil: "load", timeout: 25000 });
await page.waitForTimeout(1800);
const mp = await page.evaluate(() => ({
  cards: document.querySelectorAll(".map-card").length,
  imgs: document.querySelectorAll(".map-card img").length,
  broken: [...document.querySelectorAll(".map-card img")].filter((i) => i.complete && i.naturalWidth === 0).length,
  count: (document.getElementById("map-count") || {}).textContent,
  placeholders: [...document.querySelectorAll(".map-card > div")].length,
}));
console.log("  maps: " + JSON.stringify(mp));
if (mp.cards < 1) fail("maps rendered nothing");
if (mp.broken > 0) fail(mp.broken + " map images are broken");
else pass("maps render " + mp.cards + " cards, " + mp.imgs + " images, 0 broken");

// Lightbox
await page.click(".map-card img");
await page.waitForTimeout(500);
const lb = await page.evaluate(() => {
  const el = document.getElementById("ex-lb");
  return { hidden: el.hidden, src: (document.getElementById("ex-lb-img") || {}).src || "", cap: (document.getElementById("ex-lb-cap") || {}).textContent || "" };
});
if (lb.hidden || !lb.src) fail("map lightbox did not open");
else pass("map lightbox opens (" + lb.cap.slice(0, 30) + ")");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const lbClosed = await page.evaluate(() => document.getElementById("ex-lb").hidden);
if (!lbClosed) fail("map lightbox did not close on Escape");
else pass("map lightbox closes on Escape");

const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (over > 1) fail("h-overflow " + over); else pass("no h-overflow");

console.log("");
console.log("TOTAL FAILURES: " + fails.length);
fails.forEach((f) => console.log("  - " + f));