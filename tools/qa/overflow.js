// Finds what genuinely widens the document: elements whose right edge passes
// the viewport AND that are not inside a horizontal scroll container or a
// closed dialog (those are legitimately off-screen).
const BASE = "http://localhost:4177";
const page = await browser.getPage("o2");

for (const [w, h] of [[320, 700], [360, 780], [390, 844]]) {
  for (const route of ["/", "/library", "/ncerts"]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(BASE + route, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(400);
    const a = await page.evaluate(() => {
      const de = document.documentElement;
      const vw = de.clientWidth;

      function contained(el) {
        let n = el.parentElement;
        while (n && n !== document.body) {
          const s = getComputedStyle(n);
          if (s.overflowX === "auto" || s.overflowX === "scroll" ||
              s.overflowX === "hidden" || s.overflowX === "clip") return true;
          if (n.getAttribute && (n.getAttribute("aria-modal") === "true" ||
              (n.className && String(n.className).indexOf("drawer") !== -1) ||
              (n.className && String(n.className).indexOf("ch-sheet") !== -1))) return true;
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
          right: Math.round(r.right),
          left: Math.round(r.left),
          w: Math.round(r.width),
          text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 26),
        });
      });

      // Also check the body's own children widths.
      const kids = [];
      [...document.body.children].forEach((el) => {
        const r = el.getBoundingClientRect();
        kids.push(el.tagName + "." + String(el.className || "?").split(" ")[0] + " w=" + Math.round(r.width));
      });

      return { over: de.scrollWidth - vw, vw, culprits: culprits.slice(0, 5), kids };
    });

    if (a.over > 1) {
      console.log("FAIL  " + w + "px " + route + " over=" + a.over + " viewport=" + a.vw);
      a.culprits.forEach((c) => console.log("        " + c.tag + "." + c.cls + " l=" + c.left + " r=" + c.right + " w=" + c.w + '  "' + c.text + '"'));
      if (!a.culprits.length) console.log("        (no uncrowned culprit; body kids: " + a.kids.join(", ") + ")");
    } else {
      console.log("PASS  " + w + "px " + route + " clean (scrollW-clientW=" + a.over + ")");
    }
  }
}