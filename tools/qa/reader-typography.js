// Reader typography audit: measures the computed reading experience and
// checks the target line length for the column actually in use.
const BASE = "http://localhost:4177";
const page = await browser.getPage("rt");

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(BASE + "/dashboard", { waitUntil: "load" });
if (/\/login/.test(page.url())) {
  await page.fill('input[name="email"]', "admin@upscnotes.in");
  await page.fill('input[name="password"]', "admin12345");
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click('button[type="submit"]')]);
}

for (const [w, h, tag] of [[1440, 900, "1440"], [768, 1024, "768"], [390, 844, "390"], [360, 780, "360"]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(BASE + "/read/modern-indian-history/1", { waitUntil: "load", timeout: 25000 });
  await page.waitForTimeout(1000);

  const m = await page.evaluate(() => {
    const body = document.querySelector(".rd-body");
    const para = document.querySelector(".rd-para");
    const title = document.querySelector(".rd-chtitle");
    const cs = getComputedStyle(body);
    const ps = para ? getComputedStyle(para) : null;
    const ts = title ? getComputedStyle(title) : null;

    // Characters per line, measured with canvas at the paragraph's real font
    // so it is independent of how the paragraph happens to wrap.
    function charsPerLine(el) {
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      const avail = r.width - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight);
      if (avail <= 0) return 0;
      const c = document.createElement("canvas").getContext("2d");
      c.font = ps.font || (getComputedStyle(document.body).fontSize + " " + ps.fontFamily);
      const w = c.measureText("abcdefghijklmnopqrstuvwxyz").width / 26;
      return w > 0 ? Math.round(avail / w) : 0;
    }

    const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return {
      columnW: Math.round(body.getBoundingClientRect().width),
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      lhRatio: +(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)).toFixed(2),
      paraMb: ps ? ps.marginBottom : null,
      paraLh: ps ? +(parseFloat(ps.lineHeight) / parseFloat(ps.fontSize)).toFixed(2) : null,
      titleSize: ts ? ts.fontSize : null,
      charsPerLine: charsPerLine(para),
      over,
      fontScale: getComputedStyle(document.documentElement).getPropertyValue("--font-scale").trim(),
    };
  });

  console.log("=== " + tag + " ===");
  console.log("  column=" + m.columnW + "px  body " + m.fontSize + " / " + m.lineHeight +
              " (lh " + m.lhRatio + ")  para lh " + m.paraLh + "  para margin-bottom " + m.paraMb);
  console.log("  title " + m.titleSize + "  ~" + m.charsPerLine + " chars per line  scale=" + m.fontScale +
              "  overflow=" + m.over);
  const ideal = m.charsPerLine >= 45 && m.charsPerLine <= 95;
  console.log("  line length in the 45-95 comfort range: " + (ideal ? "yes" : "NO"));
}