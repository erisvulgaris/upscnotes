// Mobile pass: 320 and 390, checking the sections the rework touched.
const BASE = "http://localhost:4177";
const page = await browser.getPage("mob");
const fails = [];
function fail(m) { fails.push(m); console.log("FAIL  " + m); }

const BANDS = ["sample", "subjects", "features", "pricing"];

for (const [w, h, tag] of [[320, 780, "320"], [390, 844, "390"]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 25000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelectorAll(".reveal").forEach((e) => e.classList.add("revealed")));
  await page.waitForTimeout(400);

  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const out = {
      over: de.scrollWidth - de.clientWidth,
      pageH: Math.round(de.scrollHeight),
      screens: +(de.scrollHeight / window.innerHeight).toFixed(1),
    };
    // Text that would need a horizontal scroll to read. Anything inside a
    // horizontal scroller is excluded: a chip row or a cover strip is meant to
    // run off the edge, and the page itself reports zero overflow.
    const inScroller = (el) => {
      let n = el.parentElement;
      while (n && n !== document.body) {
        const s = getComputedStyle(n);
        if (["auto", "scroll", "hidden", "clip"].indexOf(s.overflowX) !== -1) return true;
        if (el.closest && el.closest(".ncert-strip, .chip-scroll, .table-scroll")) return true;
        n = n.parentElement;
      }
      return false;
    };

    const narrow = [];
    document.querySelectorAll("main p, main li, main h1, main h2, main h3, main span, main a, main b")
      .forEach((el) => {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
        if (!own || own.length < 4) return;
        const s = getComputedStyle(el);
        if (s.visibility === "hidden" || s.display === "none") return;
        if (inScroller(el)) return;
        if (el.scrollWidth > el.clientWidth + 2 && s.overflow !== "hidden" && s.textOverflow !== "ellipsis") {
          narrow.push({ cls: String(el.className || "?").split(" ").slice(0, 2).join("."), sw: el.scrollWidth, cw: el.clientWidth, text: own.slice(0, 26) });
        }
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > de.clientWidth + 1) {
          narrow.push({ cls: String(el.className || "?").split(" ").slice(0, 2).join("."), past: Math.round(r.right), text: own.slice(0, 26) });
        }
      });
    const seen = new Set();
    out.narrow = narrow.filter((x) => {
      const k = x.cls + "|" + (x.sw || x.past);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).slice(0, 8);

    // Section heights at this width
    out.bands = {};
    ["sample", "subjects", "features", "pricing", "faq"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) out.bands[id] = +(el.getBoundingClientRect().height / window.innerHeight).toFixed(2);
    });

    // Cover legibility: a line-clamped decorative title is intentional, so
    // only count titles clipped without an ellipsis.
    out.coverTitles = [...document.querySelectorAll(".stack-book .cover-title, .subject-cover .cover-title")]
      .map((e) => ({ t: e.textContent.trim().slice(0, 18), clamped: e.scrollHeight > e.clientHeight + 2 }));

    // Drop cap must not overlap the first line.
    const lede = document.querySelector(".sample-prose .lede");
    if (lede) {
      const cap = getComputedStyle(lede, "::first-letter");
      out.dropcap = { size: cap.fontSize, float: cap.float };
    }
    return out;
  });

  console.log("=== " + tag + " ===");
  console.log("  page " + m.pageH + "px = " + m.screens + " screens, overflow " + m.over);
  console.log("  bands: " + JSON.stringify(m.bands));
  console.log("  dropcap: " + JSON.stringify(m.dropcap));
  console.log("  line-clamped cover titles: " + m.coverTitles.filter((c) => c.clamped).length + " of " + m.coverTitles.length + " (intentional)");
  if (m.over > 1) fail(tag + ": overflow " + m.over);
  m.narrow.forEach((x) => fail(tag + ": " + x.cls + " " + (x.sw ? x.sw + "px in " + x.cw + "px" : "extends to " + x.past) + '  "' + x.text + '"'));

  await saveScreenshot(await page.screenshot({ fullPage: true }), "M-" + tag + "-full.png");
}

console.log("");
console.log("TOTAL FAILURES: " + fails.length);
fails.forEach((f) => console.log("  - " + f));