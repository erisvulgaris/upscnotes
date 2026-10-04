// Split sweep: layout + a11y invariants only, no interaction waits.
// Kept small so it completes even while the audiobook build is using the CPU.
const BASE = "http://localhost:4177";
const fails = [];
function fail(m) { fails.push(m); console.log("FAIL  " + m); }

const page = await browser.getPage("fs");
const ROUTES = ["/", "/library", "/ncerts", "/terms", "/login"];

for (const [w, h] of [[360, 780], [390, 844], [768, 1024], [1440, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  let bad = 0;
  for (const route of ROUTES) {
    const errs = [];
    const onErr = (e) => errs.push(String(e.message || e));
    const onCE = (e) => { if (e.type() === "error") errs.push("console: " + e.text()); };
    page.on("pageerror", onErr); page.on("console", onCE);
    await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(250);

    const a = await page.evaluate(() => {
      const de = document.documentElement;
      const hrefs = [...document.querySelectorAll("a[href]")].map((x) => x.getAttribute("href"));
      const btn = [...document.querySelectorAll(".btn")].find((b) => {
        if (b.offsetParent === null) return false;
        const cs = getComputedStyle(b);
        return cs.visibility === "visible" && cs.display !== "none" && b.getClientRects().length > 0;
      });
      let focus = "none";
      if (btn) { btn.focus(); focus = getComputedStyle(btn).outlineStyle + " " + getComputedStyle(btn).outlineWidth; }
      return {
        over: de.scrollWidth - de.clientWidth,
        dead: [...new Set(hrefs.filter((x) => x === "#" || x === "" || x === "/#features"))].length,
        focus,
        h1: document.querySelectorAll("h1").length,
        skip: !!document.querySelector(".skip-link"),
        alt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
        emoji: (document.body.innerText || "").match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || [],
        desc: !!((document.querySelector('meta[name="description"]') || {}).content || ""),
      };
    });
    page.off("pageerror", onErr); page.off("console", onCE);

    const why = [];
    if (a.over > 1) why.push("overflow " + a.over);
    if (a.dead) why.push(a.dead + " dead links");
    if (/none 0px/.test(a.focus)) why.push("no focus ring");
    if (a.h1 !== 1) why.push("h1=" + a.h1);
    if (!a.skip) why.push("no skip link");
    if (a.alt) why.push(a.alt + " img no alt");
    if (a.emoji.length) why.push(a.emoji.length + " emoji");
    if (!a.desc) why.push("no meta desc");
    errs.forEach((e) => why.push("js: " + e.slice(0, 60)));
    if (why.length) { bad++; fail(w + "px " + route + " — " + why.join(", ")); }
  }
  if (!bad) console.log("PASS  " + w + "px: " + ROUTES.length + " routes clean (overflow, dead links, focus, h1, skip link, alt, emoji, meta, console)");
}
console.log("");
console.log("TOTAL FAILURES: " + fails.length);