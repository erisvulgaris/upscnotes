// Does the expanded options panel ever cover reading text? The panel widens
// from the right, so it must not reach past the column edge.
const BASE = "http://localhost:4177";
const page = await browser.getPage("pnl");
const fails = [];

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(BASE + "/dashboard", { waitUntil: "load" });
if (/\/login/.test(page.url())) {
  await page.fill('input[name="email"]', "admin@upscbooks.in");
  await page.fill('input[name="password"]', "admin12345");
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click('button[type="submit"]')]);
}

for (const [w, h] of [[1280, 900], [1440, 900], [1600, 1000], [1920, 1080], [1024, 800], [900, 800]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(BASE + "/read/economics/1", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1200);

  // Closed, then open, measuring the column edge each time.
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, document.documentElement.scrollHeight * 0.4);
  });
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => {
    const d = document.getElementById("tts-dock").getBoundingClientRect();
    const b = document.querySelector(".rd-body").getBoundingClientRect();
    return { dockL: Math.round(d.left), dockW: Math.round(d.width), colR: Math.round(b.right) };
  });

  await page.click("#tts-toggle");
  await page.waitForTimeout(500);
  const open = await page.evaluate(() => {
    const dock = document.getElementById("tts-dock");
    const d = dock.getBoundingClientRect();
    const b = document.querySelector(".rd-body").getBoundingClientRect();
    // Count reading text actually intersecting the panel.
    let hits = 0;
    document.querySelectorAll(".rd-body p, .rd-body h1, .rd-body h3, .rd-body li").forEach((el) => {
      if (el.offsetParent === null) return;
      for (const r of el.getClientRects()) {
        if (r.height < 2 || r.width < 2) continue;
        if (r.bottom > d.top && r.top < d.bottom && r.right > d.left && r.left < d.right) hits++;
      }
    });
    return {
      dockL: Math.round(d.left), dockW: Math.round(d.width), dockH: Math.round(d.height),
      colR: Math.round(b.right), hits,
      overlap: Math.round(d.left) < Math.round(b.right),
    };
  });

  const tag = w + "px";
  // Assert on covered *text*, not on the column's box. The box includes its
  // own horizontal padding, so the panel can sit inside the padding without
  // covering a single word - which is the same trap the overflow check hit.
  if (open.hits > 0) {
    fails.push(tag + " open panel covers " + open.hits + " text line(s)");
    console.log("FAIL  " + tag + "  open panel covers " + open.hits +
      " text line(s)  panel " + open.dockW + "x" + open.dockH +
      "  left=" + open.dockL + " columnRight=" + open.colR);
  } else {
    const note = open.overlap ? "  (sits in the column's padding, no text)" : "";
    console.log("PASS  " + tag + "  closed=" + closed.dockW + "px  open=" + open.dockW + "px" +
      "  panel left=" + open.dockL + "  column right=" + open.colR + "  text covered=0" + note);
  }
}
console.log("");
console.log("TOTAL FAILURES: " + fails.length);
fails.forEach((f) => console.log("  - " + f));