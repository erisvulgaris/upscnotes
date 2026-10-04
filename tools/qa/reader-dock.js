// Light dock sweep: same invariants, 2 scroll positions instead of 5, so it
// finishes while the audiobook build is saturating the CPU.
const BASE = "http://localhost:4177";
const page = await browser.getPage("dk");
const fails = [];

for (const [w, h] of [[360, 780], [768, 1024], [1024, 800], [1280, 900], [1440, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(BASE + "/read/indian-polity/3", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(1200);

  let hits = 0, floating = false, dockW = 0, endOk = true;
  for (const f of [0.5, 1]) {
    await page.evaluate((frac) => {
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * frac);
    }, f);
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const dock = document.getElementById("tts-dock");
      if (!dock || dock.hidden) return { hits: 0, dockW: 0, floating: false, endOk: true };
      const dr = dock.getBoundingClientRect();
      const floatingNow = dr.width < window.innerWidth - 40;
      let h = 0;
      document.querySelectorAll(".rd-body p, .rd-body h1, .rd-body h3, .rd-body li, .rd-next a, .rd-end a, .rd-end p").forEach((el) => {
        if (el.offsetParent === null) return;
        for (const rc of el.getClientRects()) {
          if (rc.height < 2 || rc.width < 2) continue;
          if (rc.bottom > dr.top && rc.top < dr.bottom && rc.right > dr.left && rc.left < dr.right) h++;
        }
      });
      const last = document.querySelector(".rd-end a, .rd-end p");
      let endOk = true;
      if (last) {
        const lr = last.getBoundingClientRect();
        endOk = !(lr.bottom > dr.top && lr.top < dr.bottom && lr.right > dr.left && lr.left < dr.right);
      }
      return { hits: h, dockW: Math.round(dr.width), floating: floatingNow, endOk };
    });
    hits += r.hits; floating = r.floating; dockW = r.dockW; endOk = endOk && r.endOk;
  }

  if (!endOk) { fails.push(w + "px end of chapter under dock"); console.log("FAIL  " + w + "px  end of chapter under the dock"); }
  else if (floating && hits > 0) { fails.push(w + "px floating dock covers text"); console.log("FAIL  " + w + "px  floating dock covers text"); }
  else console.log("PASS  " + w + "px  " + (floating ? "floating dock " + dockW + "px clear" : "bottom bar, chapter end reachable"));
}
console.log("");
console.log("TOTAL FAILURES: " + fails.length);