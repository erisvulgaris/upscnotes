// Which font files does the browser actually fetch on a Latin page?
// Six faces exist; a correct unicode-range setup fetches two.
const BASE = "http://localhost:4177";

async function probe(route, label, injectHindi) {
  const page = await browser.getPage("f" + label);
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  const fetched = [];
  client.on("Network.requestWillBeSent", (e) => {
    if (/\.woff2?(\?|$)/.test(e.request.url)) fetched.push(e.request.url.split("/").pop());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + route, { waitUntil: "load", timeout: 25000 });
  await page.waitForTimeout(1800);

  if (injectHindi) {
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.style.cssText = "font-family:var(--font-body);font-size:28px;padding:20px";
      d.textContent = "\u0926\u0947\u0936 \u0915\u093e \u0938\u094D\u0928\u0947\u0939\u0915\u093E\u0930";
      document.body.appendChild(d);
      return document.fonts.ready;
    });
    await page.waitForTimeout(1500);
  }

  console.log(label + " fetched " + fetched.length + ": " + fetched.join(", "));
  await page.close();
  return fetched;
}

const latin = await probe("/", "latin", false);
const hindi = await probe("/", "hindi", true);

console.log("");
console.log("EXPECT: latin page fetches only the Latin subsets (Cambay-400-0, Cambay-700-3).");
const badLatin = latin.filter((f) => /-(1|2|4|5)\.woff2$/.test(f));
console.log("latin page pulled non-Latin subsets: " + (badLatin.length ? "YES -> " + badLatin.join(", ") : "no"));
const missingHindi = hindi.filter((f) => /-2\.woff2$|-5\.woff2$/.test(f));
console.log("hindi page pulled the Devanagari subsets: " + (missingHindi.length ? "yes (" + missingHindi.join(", ") + ")" : "NO — devanagari would fall back"));