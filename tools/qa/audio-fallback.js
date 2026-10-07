// End-to-end test of the Edge TTS fallback player.
//
// The Canary browser has no speech voices, which is exactly the condition the
// fallback exists for, so this exercises the real code path: it must load the
// chapter's timings, stream the Opus, advance the sentence highlight, seek,
// and report progress.
const BASE = "http://localhost:4177";
const page = await browser.getPage("af");
const fails = [];
function fail(m) { fails.push(m); console.log("FAIL  " + m); }
function pass(m) { console.log("PASS  " + m); }

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(BASE + "/dashboard", { waitUntil: "load" });
if (/\/login/.test(page.url())) {
  await page.fill('input[name="email"]', "admin@upscnotes.in");
  await page.fill('input[name="password"]', "admin12345");
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click('button[type="submit"]')]);
}

// Find a chapter that has audio. economics ch1 is known-good.
const man = await page.evaluate(async () => {
  const r = await fetch("/audio/manifest.json", { credentials: "same-origin" });
  return r.json();
});
const books = Object.keys(man.books || {});
if (!books.length) { console.log("NO AUDIO BUILT YET — skipping"); process.exit(0); }
let pick = null;
for (const s of books) {
  for (const [n, meta] of Object.entries(man.books[s])) {
    if ((meta.duration || 0) > 300 && (meta.sentences || 0) > 50) { pick = { s, n, meta }; break; }
  }
  if (pick) break;
}
console.log("testing " + pick.s + " ch" + pick.n + " (" + Math.round(pick.meta.duration) + "s, " + pick.meta.sentences + " sentences)");

await page.goto(BASE + "/read/" + pick.s + "/" + pick.n, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(1500);

// The fallback must have taken over: the dock exists, the voice/speed rows
// (which the fallback cannot honour) are hidden, and a status is announced.
const attached = await page.evaluate(() => ({
  hasAudioEl: typeof window.Audio !== "undefined",
  sr: (document.getElementById("tts-sr") || {}).textContent || "",
  now: (document.getElementById("tts-now") || {}).textContent || "",
  playLabel: (document.getElementById("tts-play") || {}).getAttribute("aria-label") || "",
  voiceRowHidden: (() => { const v = document.getElementById("tts-voice"); return v ? v.closest(".tts-panel-row").hidden : null; })(),
  rateRowHidden: (() => { const v = document.querySelector("[data-rate]"); return v ? v.closest(".tts-panel-row").hidden : null; })(),
  sentences: document.querySelectorAll(".tts-sent").length,
}));
console.log("  " + JSON.stringify(attached));
if (!/no working speech voice/i.test(attached.sr)) fail("fallback did not announce that the browser has no voice");
else pass("fallback announced itself: " + attached.sr.trim());
if (attached.voiceRowHidden !== true) fail("voice picker still shown by the fallback (it cannot honour it)");
if (attached.rateRowHidden !== true) fail("speed presets still shown by the fallback");
else pass("fallback hides the controls it cannot honour");

// Press play: it must load timings, stream the audio and start moving.
await page.click("#tts-play");
await page.waitForTimeout(3500);

const playing = await page.evaluate(() => {
  const a = document.querySelector("audio") || window.__afAudio;
  const now = (document.getElementById("tts-now") || {}).textContent || "";
  const pos = (document.getElementById("tts-pos") || {}).textContent || "";
  const active = document.querySelectorAll(".tts-sent.is-active").length;
  const fill = (document.getElementById("tts-fill") || {}).style.width || "";
  return { now, pos, active, fill };
});
console.log("  after play: " + JSON.stringify(playing));
if (playing.active !== 1) fail("no sentence highlighted during playback (" + playing.active + ")");
else pass("sentence highlighting active, pos=" + playing.pos);
if (!/recorded narration/i.test(playing.now) && !playing.now) fail("dock status not updated");

// Give it long enough to cross a sentence boundary. Interpolated spans inside a
// chunk average ~6s and the longest is ~20s, so a 12s wait can legitimately
// still be on sentence 0.
const before = await page.evaluate(() => {
  const el = document.querySelector(".tts-sent.is-active");
  return el ? el.getAttribute("data-sid") : null;
});
await page.waitForTimeout(26000);
const after = await page.evaluate(() => {
  const el = document.querySelector(".tts-sent.is-active");
  return {
    sid: el ? el.getAttribute("data-sid") : null,
    fill: (document.getElementById("tts-fill") || {}).style.width || "",
    pos: (document.getElementById("tts-pos") || {}).textContent || "",
  };
});
console.log("  sid " + before + " -> " + JSON.stringify(after));
if (after.sid === before) fail("highlight did not advance over 26s of playback");
else pass("highlight advanced with playback (" + before + " -> " + after.sid + ", fill " + after.fill + ")");

// Next / previous sentence.
await page.click("#tts-next");
await page.waitForTimeout(600);
const jumped = await page.evaluate(() => {
  const el = document.querySelector(".tts-sent.is-active");
  return el ? el.getAttribute("data-sid") : null;
});
if (jumped === after.sid) fail("next-sentence did not move the highlight");
else pass("next sentence: " + after.sid + " -> " + jumped);

// Stop, then pause/resume behaviour.
await page.click("#tts-stop");
await page.waitForTimeout(500);
const stopped = await page.evaluate(() => ({
  now: (document.getElementById("tts-now") || {}).textContent,
  active: document.querySelectorAll(".tts-sent.is-active").length,
}));
if (stopped.active !== 0) fail("stop left a sentence highlighted");
else pass("stop clears the highlight (" + stopped.now + ")");

console.log("");
console.log("TOTAL FAILURES: " + fails.length);
fails.forEach((f) => console.log("  - " + f));