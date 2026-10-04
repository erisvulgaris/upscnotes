// Dark mode pass on the landing page. Walks every band in both themes and
// reports anything that fails to repaint, sits at low contrast, or keeps a
// light-mode-only value.
const BASE = "http://localhost:4177";
const page = await browser.getPage("dark");

const fails = [];
function fail(m) { fails.push(m); console.log("FAIL  " + m); }
function pass(m) { console.log("PASS  " + m); }

const BANDS = ["sample", "subjects", "spotlight", "features", "ncert", "pricing", "faq"];

for (const [w, h, tag] of [[1440, 900, "1440"], [390, 844, "390"]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 25000 });
  await page.waitForTimeout(800);

  const captured = {};
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => { document.documentElement.setAttribute("data-theme", t); }, theme);
    await page.waitForTimeout(450);
    await page.evaluate(() => document.querySelectorAll(".reveal").forEach((e) => e.classList.add("revealed")));
    await page.waitForTimeout(300);

    const r = await page.evaluate((bands) => {
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
      function bgOf(el) {
        let n = el;
        while (n && n !== document.documentElement) {
          const b = parse(getComputedStyle(n).backgroundColor);
          if (b && b.a > 0.85) return b;
          n = n.parentElement;
        }
        return parse(getComputedStyle(document.body).backgroundColor) || { rgb: [255, 255, 255], a: 1 };
      }

      const out = { bodyBg: getComputedStyle(document.body).backgroundColor, bands: {}, low: [] };
      bands.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        out.bands[id] = getComputedStyle(el).backgroundColor;
      });

      document.querySelectorAll("main p, main span, main a, main b, main h1, main h2, main h3, main li")
        .forEach((el) => {
          const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
          if (!own || own.length < 4) return;
          const s = getComputedStyle(el);
          if (s.visibility === "hidden" || s.display === "none") return;
          const rect = el.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) return;
          if (el.closest(".stack-book, .subject-cover, .ncert-strip-cover, .spotlight-cover, .sample-book-cover")) return;
          const fg = parse(s.color);
          const bg = bgOf(el);
          if (!fg || !bg) return;
          const l1 = lum(fg.rgb), l2 = lum(bg.rgb);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          const size = parseFloat(s.fontSize);
          const large = size >= 24 || (size >= 18.66 && parseInt(s.fontWeight, 10) >= 700);
          const need = large ? 3 : 4.5;
          if (ratio < need) {
            out.low.push({
              cls: String(el.className || "?").split(" ").slice(0, 2).join("."),
              ratio: Math.round(ratio * 100) / 100, need, text: own.slice(0, 30),
            });
          }
        });
      // Dedupe
      const seen = new Set();
      out.low = out.low.filter((x) => {
        const k = x.cls + "|" + x.ratio;
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
      return out;
    }, BANDS);

    captured[theme] = r;
    console.log("  " + tag + " " + theme.padEnd(5) + " body=" + r.bodyBg +
      "  bands=" + Object.keys(r.bands).length +
      (r.low.length ? "  LOW: " + r.low.map((x) => x.cls + "@" + x.ratio).join(", ") : ""));
    r.low.forEach((x) => {
      if (x.need > 3.5 || x.ratio < 3) fail(tag + " " + theme + ": " + x.cls + " " + x.ratio + " (need " + x.need + ") \"" + x.text + "\"");
    });

    // Every band must actually repaint between themes.
    if (theme === "dark") {
      BANDS.forEach((id) => {
        const l = captured.light.bands[id];
        const d = captured.dark.bands[id];
        if (l && d && l === d && id !== "faq") {
          // Same background is fine when it is transparent (inherits body).
          if (l !== "rgba(0, 0, 0, 0)") fail(tag + " band " + id + " keeps the same background in both themes: " + l);
        }
      });
      if (captured.light.bodyBg === captured.dark.bodyBg) fail(tag + " body background does not change between themes");
      else pass(tag + ": body repaints " + captured.light.bodyBg + " -> " + captured.dark.bodyBg);
    }

    await saveScreenshot(await page.screenshot({ fullPage: false }), "D-" + tag + "-" + theme + ".png");
  }
}

console.log("");
console.log("TOTAL FAILURES: " + fails.length);
fails.forEach((f) => console.log("  - " + f));