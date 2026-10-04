// Finds what genuinely widens the document.
//
// Two traps this script originally fell into, both worth remembering:
//
// 1. documentElement.scrollWidth is NOT a reliable overflow signal when
//    body has overflow-x: hidden. A wide table inside its own
//    overflow-x:auto wrapper still inflates scrollWidth, even though the
//    reader cannot scroll the page sideways and every column is reachable.
//    The honest question is "can the user scroll the page sideways?", so
//    that is what this asserts first; scrollWidth is only a hint.
//
// 2. Elements inside horizontal scrollers and inside closed off-screen
//    dialogs are legitimately outside the viewport and must be ignored.
const BASE = "http://localhost:4177";
const page = await browser.getPage("o2");

const f = [];                       // real defects
const hints = [];                   // scrollWidth inflated but harmless

for (const [w, h] of [[320, 700], [360, 780], [390, 844]]) {
  for (const route of ["/", "/library", "/ncerts"]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(BASE + route, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(400);
    const a = await page.evaluate(() => {
      const de = document.documentElement;
      const vw = de.clientWidth;

      // The real test: attempt to scroll the page sideways.
      window.scrollTo(9999, 0);
      const pageScrolled = window.scrollX > 0;
      window.scrollTo(0, 0);

      function contained(el) {
        if (el.closest && el.closest(".drawer, .ch-sheet")) return true;
        let n = el.parentElement;
        while (n && n !== document.body) {
          const s = getComputedStyle(n);
          if (s.overflowX === "auto" || s.overflowX === "scroll" ||
              s.overflowX === "hidden" || s.overflowX === "clip") return true;
          n = n.parentElement;
        }
        return false;
      }

      const culprits = [];
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.right <= vw + 0.5) return;
        if (contained(el)) return;
        culprits.push({
          tag: el.tagName,
          cls: String(el.className || "?").split(" ").slice(0, 2).join("."),
          l: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
          text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 26),
        });
      });

      return {
        pageScrolled,
        scrollWidthOver: de.scrollWidth - vw,
        vw,
        culprits: culprits.slice(0, 5),
      };
    });

    const tag = w + "px " + route;
    if (a.pageScrolled) {
      f.push(tag + " — the page scrolls sideways");
      console.log("FAIL  " + tag + "  the page can be scrolled horizontally");
    } else if (a.culprits.length) {
      f.push(tag + " — uncrowned element past the viewport");
      console.log("FAIL  " + tag + "  elements past the viewport:");
      a.culprits.forEach((c) => console.log("        " + c.tag + "." + c.cls + " l=" + c.l + " r=" + c.right + "  \"" + c.text + "\""));
    } else if (a.scrollWidthOver > 1) {
      hints.push(tag + " (scrollWidth +" + a.scrollWidthOver + " but page cannot scroll)");
      console.log("PASS  " + tag + "  page cannot scroll sideways  [hint: scrollWidth +" + a.scrollWidthOver + ", all of it inside a scroll container]");
    } else {
      console.log("PASS  " + tag + "  clean");
    }
  }
}

console.log("");
console.log("real defects: " + f.length);
hints.forEach((x) => console.log("  hint: " + x));