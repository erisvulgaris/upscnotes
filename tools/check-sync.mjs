// Is the cached audio aligned with the sentences the reader highlights?
//
// The sidecar timings come from narrationText()'s chunking; the highlighted
// spans come from renderChapter's own sentence segmentation. If the two lists
// differ, index i in the timings is not the sentence being highlighted - which
// means the audio says one thing while another is lit up.
import { signIn, alignSentences, norm } from './lib.mjs';

const BASE = 'http://localhost:4177';
const { cookie } = await signIn(BASE);

const manRes = await fetch(BASE + '/audio/manifest.json', { headers: { cookie: cookie() } });
if (!manRes.ok) { console.error('manifest ' + manRes.status); process.exit(1); }
const man = await manRes.json();
const slugs = Object.keys(man.books || {});
console.log('books with audio: ' + slugs.length + '\n');

const rows = [];
let totalDom = 0, totalAudio = 0, totalAligned = 0, exact = 0;

for (const slug of slugs) {
  const nums = Object.keys(man.books[slug]).map(Number).sort((x, y) => x - y);
  // Sample two chapters per book: the first and a middle one.
  for (const n of [nums[0], nums[Math.floor(nums.length / 2)]]) {
    const pageRes = await fetch(`${BASE}/read/${slug}/${n}`, { headers: { cookie: cookie() } });
    if (!pageRes.ok) continue;
    const page = await pageRes.text();

    const dom = [...page.matchAll(/class="tts-sent" data-sid="\d+"[^>]*>([\s\S]*?)<\/span>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').trim());
    if (!dom.length) continue;

    const sideRes = await fetch(`${BASE}/audio/${slug}/${n}.json`, { headers: { cookie: cookie() } });
    if (!sideRes.ok) continue;
    const side = await sideRes.json();
    const audio = (side.sentenceTimings || []);

    const map = alignSentences(dom, audio.map((t) => t.text));
    let mismatches = 0;
    for (let i = 0; i < map.length; i++) if (map[i] !== i) mismatches++;

    totalDom += dom.length;
    totalAudio += audio.length;
    totalAligned += dom.length - mismatches;
    if (mismatches === 0) exact++;
    rows.push({ slug, n, dom: dom.length, audio: audio.length, mismatches });
  }
}

console.log('book                                     ch    DOM  audio  misaligned');
for (const x of rows.filter((r) => r.mismatches > 0).slice(0, 14)) {
  console.log('  ' + x.slug.slice(0, 37).padEnd(39) + String(x.n).padStart(3) +
    String(x.dom).padStart(5) + String(x.audio).padStart(7) + String(x.mismatches).padStart(11));
}
const clean = rows.filter((r) => r.mismatches === 0).length;
console.log('');
console.log('chapters checked      : ' + rows.length);
console.log('already 1:1           : ' + clean);
console.log('needing alignment     : ' + (rows.length - clean));
console.log('DOM sentences         : ' + totalDom);
console.log('audio sentences       : ' + totalAudio);
console.log('aligned by text       : ' + totalAligned + ' / ' + totalDom +
  '  (' + Math.round((totalAligned / Math.max(1, totalDom)) * 100) + '%)');

if (rows.length && totalDom !== totalAudio) {
  console.log('');
  console.log('counts differ by ' + (totalDom - totalAudio) +
    ' — a raw index would drift by that much by the end of a chapter');
}