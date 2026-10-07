// Keyboard-only walk. Tabs through every page, asserting focus is always
// visible, never lands on an invisible element, and reaches the main content
// via the skip link.
const BASE = "http://localhost:4177";
const fails = [];
function fail(m) { fails.push(m); console.log("FAIL  " + m); }

async function walk(route, label, maxTabs = 60) {
  const page = await browser.getPage("k" + label);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + route, { waitUntil: "load", timeout: 25000 });
  await page.waitForTimeout(600);

  // Skip link is the first stop and must become visible on focus.
  await page.keyboard.press("Tab");
  await page.waitForTimeout(150);
  const skip = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return { tag: "none" };
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      tag: el.tagName, cls: String(el.className || ""),
      text: (el.textContent || "").trim(),
      visible: r.width > 1 && r.height > 1 && r.top >= 0,
      outline: s.outlineStyle + " " + s.outlineWidth,
    };
  });
  if (skip.cls.indexOf("skip-link") === -1) fail(label + ": first Tab is not the skip link (" + skip.cls + ")");
  else if (!skip.visible) fail(label + ": skip link stays off-screen when focused");
  else console.log("PASS  " + label + ": skip link focused and visible");

  const seq = [];
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // Elements that are display:none or visibility:hidden must not be focusable.
      const hidden = cs.display === "none" || cs.visibility === "hidden";
      // Effective focus ring: outline, or a box-shadow ring, or a border change.
      const hasRing = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
        (cs.boxShadow && cs.boxShadow !== "none");
      return {
        tag: el.tagName,
        id: el.id || "",
        cls: String(el.className || "").split(" ").slice(0, 2).join("."),
        text: (el.getAttribute && (el.getAttribute("aria-label") || el.textContent || "")).trim().replace(/\s+/g, " ").slice(0, 30),
        hidden, hasRing,
        w: Math.round(r.width), h: Math.round(r.height),
      };
    });
    if (!s) break;
    seq.push(s);
    if (s.hidden) fail(label + ": focus landed on a hidden element: " + s.tag + "." + s.cls);
    if (!s.hasRing) fail(label + ": focusable with no visible ring: " + s.tag + "." + s.cls + " '" + s.text + "'");
    if (s.w > 0 && s.h > 0 && s.h < 24) fail(label + ": tiny focus target " + s.h + "px: " + s.tag + "." + s.cls + " '" + s.text + "'");
  }

  const unique = new Set(seq.map((s) => s.tag + "." + s.cls + "#" + s.id));
  console.log("      " + label + ": " + seq.length + " stops, " + unique.size + " distinct");
  await page.close();
}

await walk("/", "home");
await walk("/library", "library");
await walk("/ncerts", "ncerts");
await walk("/login", "login");
await walk("/terms", "terms");

console.log("");
console.log("=== READER (signed in) ===");
const p2 = await browser.getPage("kreader");
await p2.setViewportSize({ width: 1440, height: 900 });
await p2.goto(BASE + "/dashboard", { waitUntil: "load" });
if (/\/login/.test(p2.url())) {
  await p2.fill('input[name="email"]', "admin@upscnotes.in");
  await p2.fill('input[name="password"]', "admin12345");
  await Promise.all([p2.waitForNavigation({ waitUntil: "load" }), p2.click('button[type="submit"]')]);
}
await p2.goto(BASE + "/read/modern-indian-history/1", { waitUntil: "load" });
await p2.waitForTimeout(1200);
const reader = await p2.evaluate(() => {
  const dock = document.getElementById("tts-dock");
  return {
    dockVisible: dock && !dock.hidden,
    playFocusedRing: (() => {
      const b = document.getElementById("tts-play");
      if (!b) return "no-play";
      b.focus();
      const cs = getComputedStyle(b);
      return cs.outlineStyle + " " + cs.outlineWidth;
    })(),
    dockOrder: [...document.querySelectorAll("#tts-dock button, #tts-dock select")].map((b) => b.id || b.getAttribute("data-rate") || b.tagName),
  };
});
console.log("      reader dock visible=" + reader.dockVisible + " play ring=" + reader.playFocusedRing);
console.log("      dock control order: " + reader.dockOrder.join(" -> "));
if (/none 0px/.test(reader.playFocusedRing)) fail("reader: TTS play button has no focus ring");

console.log("");
console.log("TOTAL FAILURES: " + fails.length);
fails.forEach((f) => console.log("  - " + f));