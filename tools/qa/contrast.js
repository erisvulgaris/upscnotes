// Compact contrast check: landing page only, both themes, and it accounts for
// the cover scrim (a pseudo-element the naive background walk cannot see).
const BASE = "http://localhost:4177";
const page = await browser.getPage("ct");
const fails = [];

for (const theme of ["light", "dark"]) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 25000 });
  await page.waitForTimeout(600);
  await page.evaluate((t) => { document.documentElement.setAttribute("data-theme", t); }, theme);
  await page.waitForTimeout(400);

  const res = await page.evaluate(() => {
    function lum(rgb) {
      const c = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    function parse(c) {
      const m = String(c).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(",").map((x) => parseFloat(x));
      return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
    }
    // Composite whatever scrim the element actually carries over its background.
    // Components differ: .cover-art uses ::before, .subject-cover uses ::after.
    // Reading only one of them produced a 3.73:1 false failure on the subject
    // shelf - the metric could not see what the reader actually sees.
    function scrimOf(el) {
      let bi = "none";
      for (const pe of ["::before", "::after"]) {
        const s = getComputedStyle(el, pe).backgroundImage;
        if (s && s !== "none") { bi = s; break; }
      }
      if (!bi || bi === "none") return null;
      const stops = [...bi.matchAll(/rgba?\(([^)]+)\)\s+([\d.]+)?%?/g)].map((m) => {
        const p = m[1].split(",").map((x) => parseFloat(x));
        return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1, pos: m[2] ? parseFloat(m[2]) : null };
      });
      return stops.length ? stops : null;
    }
    function blend(fg, bg) {
      return { rgb: [0, 1, 2].map((i) => fg.rgb[i] * fg.a + bg.rgb[i] * (1 - fg.a)), a: 1 };
    }
    function bgOf(el) {
      let n = el;
      while (n && n !== document.documentElement) {
        const b = parse(getComputedStyle(n).backgroundColor);
        if (b && b.a > 0.85) return b;
        n = n.parentElement;
      }
      return parse(getComputedStyle(document.body).backgroundColor) || { rgb: [255, 255, 255], a: 1 };
    }

    const out = [];
    document.querySelectorAll("p,span,a,h1,h2,h3,li,button,summary,td,th,b,strong").forEach((el) => {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
      if (!own) return;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || parseFloat(s.opacity) < 0.4) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;

      let fg = parse(s.color);
      if (!fg) return;
      let bg = bgOf(el);

      // Cover art: the ::before scrim sits between the text and the cover colour.
      const art = el.closest(".cover-art, .subject-cover, .stack-book, .ncert-strip-cover, .sample-book-cover, .continue-cover");
      if (art) {
        const stops = scrimOf(art);
        const artBg = parse(getComputedStyle(art).backgroundColor);
      const base = artBg && artBg.a > 0.85 ? artBg : bgOf(art.parentElement);
        if (stops) {
          // Use the strongest (most opaque) stop as the worst case.
          const worst = stops.reduce((a, b) => (b.a > a.a ? b : a), stops[0]);
          bg = blend(worst, base);
        }
      }

      const l1 = lum(fg.rgb), l2 = lum(bg.rgb);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(s.fontSize);
      const large = size >= 24 || (size >= 18.66 && parseInt(s.fontWeight, 10) >= 700);
      const need = large ? 3 : 4.5;
      if (ratio < need) {
        out.push({
          cls: String(el.className || "?").split(" ").slice(0, 2).join("."),
          ratio: Math.round(ratio * 100) / 100,
          need,
          text: own.slice(0, 34),
        });
      }
    });
    const seen = new Set();
    return out.filter((x) => {
      const k = x.cls + "|" + x.ratio;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  });

  console.log("=== " + theme + " ===");
  res.forEach((x) => console.log("  " + x.ratio + " (need " + x.need + ") " + x.cls + '  "' + x.text + '"'));
  fails.push(...res.map((x) => theme + " " + x.cls));
  if (!res.length) console.log("  clean");
}
console.log("");
console.log("TOTAL: " + fails.length);