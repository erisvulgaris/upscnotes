// Timeline: is it actually chronological, and are duplicates collapsed?
const BASE = "http://localhost:4177";
const page = await browser.getPage("tl");
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

for (const book of ["modern-indian-history", "indian-polity", "spectrum-modern-india"]) {
  await page.goto(BASE + "/book/" + book + "/timeline", { waitUntil: "load", timeout: 25000 });
  await page.waitForTimeout(1600);

  const r = await page.evaluate(() => {
    function key(when) {
      const s = String(when || '').toLowerCase().trim();
      const m = s.match(/(\d{1,4})/);
      if (!m) return Number.MAX_SAFE_INTEGER;
      let y = parseInt(m[1], 10);
      if (/\d\s*(?:st|nd|rd|th)?\s*(?:c\.?|century|cent)\b/.test(s)) y *= 100;
      if (/\bbce\b|\bbefore\b|^pre-/.test(s)) y = -y;
      return y;
    }
    const items = [...document.querySelectorAll(".tl-item")].map((el) => ({
      when: el.querySelector(".tl-year").textContent.trim(),
      label: (el.querySelector(".tl-label") || {}).textContent || "",
    }));
    const keys = items.map((i) => key(i.when));
    let inversions = 0;
    for (let i = 1; i < keys.length; i++) if (keys[i] < keys[i - 1]) inversions++;
    const seen = new Set();
    let dupes = 0;
    items.forEach((i) => {
      const k = i.when + ' ' + i.label;
      if (seen.has(k)) dupes++;
      seen.add(k);
    });
    return {
      total: items.length,
      count: (document.getElementById("tl-count") || {}).textContent,
      inversions, dupes,
      first5: items.slice(0, 5).map((i) => i.when + " — " + i.label.slice(0, 34)),
    };
  });

  console.log("=== " + book + " ===");
  console.log("  " + r.total + " rendered | " + r.count);
  r.first5.forEach((x) => console.log("    " + x));
  if (r.inversions > 0) fail(book + ": " + r.inversions + " chronological inversions");
  else pass(book + ": chronological (" + r.total + " events, 0 inversions)");
  if (r.dupes > 0) fail(book + ": " + r.dupes + " duplicate rows still rendered");
  else pass(book + ": no duplicate rows");
}

// Search still narrows.
await page.goto(BASE + "/book/modern-indian-history/timeline", { waitUntil: "load" });
await page.waitForTimeout(1400);
await page.fill("#tl-q", "Mughal");
await page.waitForTimeout(600);
const s = await page.evaluate(() => ({
  n: document.querySelectorAll(".tl-item").length,
  txt: (document.getElementById("tl-count") || {}).textContent,
}));
console.log("  search 'Mughal' -> " + s.n + " (" + s.txt + ")");
if (!(s.n > 0 && s.n < 180)) fail("timeline search did not narrow: " + s.n);
else pass("timeline search narrows to " + s.n);

const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (over > 1) fail("timeline h-overflow " + over); else pass("no h-overflow");

console.log("");
console.log("TOTAL FAILURES: " + fails.length);
fails.forEach((f) => console.log("  - " + f));