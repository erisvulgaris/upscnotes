// The same honest overflow test, on the authenticated surfaces where a wide
// table genuinely exists.
const BASE = "http://localhost:4177";
const page = await browser.getPage("o3");

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(BASE + "/login", { waitUntil: "load" });
if (/\/login/.test(page.url())) {
  await page.fill('input[name="email"]', "admin@upscbooks.in");
  await page.fill('input[name="password"]', "admin12345");
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click('button[type="submit"]')]);
}

const f = [], hints = [];
for (const [w, h] of [[360, 780], [390, 844], [768, 1024]]) {
  for (const route of ["/dashboard", "/admin/users", "/admin/payments", "/admin/books", "/book/modern-indian-history/quiz"]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(BASE + route, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(600);
    const a = await page.evaluate(() => {
      const de = document.documentElement;
      const vw = de.clientWidth;
      window.scrollTo(9999, 0);
      const pageScrolled = window.scrollX > 0;
      window.scrollTo(0, 0);

      // Any horizontal scroll container whose content is wider than itself is
      // fine, but its own box must still sit inside the viewport.
      const scrollers = [...document.querySelectorAll("*")].filter((el) => {
        const s = getComputedStyle(el);
        return (s.overflowX === "auto" || s.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1;
      });
      const widest = scrollers.map((el) => Math.round(el.getBoundingClientRect().width)).sort((x, y) => y - x)[0] || 0;

      function contained(el) {
        if (el.closest && el.closest(".drawer, .ch-sheet")) return true;
        let n = el.parentElement;
        while (n && n !== document.body) {
          const s = getComputedStyle(n);
          if (["auto", "scroll", "hidden", "clip"].indexOf(s.overflowX) !== -1) return true;
          n = n.parentElement;
        }
        return false;
      }
      const culprits = [];
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.right <= vw + 0.5) return;
        if (contained(el)) return;
        culprits.push({ tag: el.tagName, cls: String(el.className || "?").split(" ").slice(0, 2).join("."), right: Math.round(r.right) });
      });
      return { pageScrolled, over: de.scrollWidth - vw, widestScroller: widest, culprits: culprits.slice(0, 4), scrollers: scrollers.length };
    });

    const tag = w + "px " + route;
    if (a.pageScrolled) { f.push(tag); console.log("FAIL  " + tag + "  page scrolls sideways"); }
    else if (a.culprits.length) {
      f.push(tag);
      console.log("FAIL  " + tag + "  " + JSON.stringify(a.culprits));
    } else if (a.over > 1) {
      hints.push(tag + " +" + a.over + "px (page cannot scroll; widest scroller " + a.widestScroller + "px)");
      console.log("PASS  " + tag + "  cannot scroll sideways  [hint: scrollWidth +" + a.over + ", " + a.scrollers + " internal scroller(s)]");
    } else {
      console.log("PASS  " + tag + "  clean");
    }
  }
}
console.log("");
console.log("real defects: " + f.length);
hints.forEach((x) => console.log("  hint: " + x));