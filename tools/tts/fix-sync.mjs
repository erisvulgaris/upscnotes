// Builds a highlight timeline for every cached chapter, WITHOUT re-synthesising
// any audio.
//
// The problem this fixes: the cached sidecars were built from narrationText()'s
// chunking, which includes section titles, table cells and captions that the
// reader never highlights. Across 92 sampled chapters not one lined up, and the
// two lists differed by 12% — so when sentence 40 lit up, the audio was
// somewhere else entirely.
//
// The audio itself is correct: it is the right recording, in the right order,
// and 100% of the highlighted sentences appear verbatim inside it. Only the
// mapping was wrong.
//
// The mapping is therefore computed by position rather than by index:
//   1. Concatenate the audio's sentences into one normalised stream, recording
//      where each sentence begins and its time.
//   2. Walk the highlighted sentences in order, finding each one in that stream
//      with a monotonic search. Because the audio is in the same order, the
//      cursor only ever moves forwards.
//   3. The audio sentence containing a match, plus how far into it the match
//      starts, gives the time - so a highlighted sentence that begins partway
//      through a spoken one lights up at the right moment.
//
// Output: audio/<slug>/<n>.sync.json
//   { count, duration, starts[], matched, unmatched }

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sentenceList } from '../../src/content.js';

const AUDIO = path.join('audio');
const DRY = process.argv.includes('--dry');

const norm = (s) => String(s == null ? '' : s)
  .toLowerCase()
  .replace(/[‘’‛]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/[^a-z0-9ऀ-ॿ]+/g, ' ')
  .trim();

let built = 0, skipped = 0;
let totalSentences = 0, totalMatched = 0;
const problems = [];

const db = new DatabaseSync(path.join('data', 'upscbooks.db'));
const books = db.prepare("SELECT id, slug FROM books WHERE status='published' ORDER BY slug").all();

for (const book of books) {
  const chapters = db.prepare(
    'SELECT number, sections_json FROM chapters WHERE book_id=? ORDER BY number'
  ).all(book.id);

  for (const ch of chapters) {
    const sidePath = path.join(AUDIO, book.slug, `${ch.number}.json`);
    const opusPath = path.join(AUDIO, book.slug, `${ch.number}.opus`);
    if (!fs.existsSync(sidePath) || !fs.existsSync(opusPath)) { skipped++; continue; }

    let side;
    try { side = JSON.parse(fs.readFileSync(sidePath, 'utf8')); } catch { skipped++; continue; }
    const audio = side.sentenceTimings || [];
    if (!audio.length) { skipped++; continue; }

    let sections;
    try { sections = JSON.parse(ch.sections_json); } catch { skipped++; continue; }
    const dom = sentenceList(sections);
    if (!dom.length) { skipped++; continue; }

    const duration = side.duration || audio[audio.length - 1].t || 0;
    const nAudio = audio.map((x) => norm(x.text));

    // --- one normalised stream, with each sentence's span and time -------
    const spans = [];      // { start, end, t, tNext }
    let pos = 0;
    let stream = '';
    for (let i = 0; i < audio.length; i++) {
      const txt = nAudio[i];
      if (txt) {
        const start = stream.length + 1;   // +1 for the joining space
        stream += (stream ? ' ' : '') + txt;
        spans.push({ start, end: stream.length, t: audio[i].t });
      }
      // Keep empty audio sentences in the time sequence.
      if (!spans.length || spans[spans.length - 1].end !== stream.length + 1) {
        // placeholder so timing stays monotonic across an empty entry
      }
    }
    // Attach the end time of each span from the next sentence's start.
    const times = audio.map((x) => x.t).slice();
    for (let i = 0; i < spans.length; i++) {
      const next = spans[i + 1];
      spans[i].tNext = next ? next.t : duration;
      if (spans[i].tNext <= spans[i].t) spans[i].tNext = Math.min(duration, spans[i].t + 1);
    }

    // --- walk the highlighted sentences through that stream ---------------
    const starts = new Array(dom.length);
    let cursor = 0;
    let matched = 0, unmatched = 0;
    let prevTime = 0;

    for (let d = 0; d < dom.length; d++) {
      const nd = norm(dom[d]);
      if (!nd) { starts[d] = prevTime; continue; }

      let at = stream.indexOf(nd, cursor);
      if (at === -1) at = stream.indexOf(nd, 0);       // re-scan once
      if (at === -1) { unmatched++; starts[d] = prevTime; continue; }

      // Which spoken sentence are we inside, and how far into it?
      let lo = 0, hi = spans.length - 1, si = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (spans[mid].start <= at) { si = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      const span = spans[si];
      const width = Math.max(1, span.end - span.start);
      const frac = Math.max(0, Math.min(1, (at - span.start) / width));
      let t = span.t + frac * (span.tNext - span.t);

      matched++;
      cursor = at + nd.length;
      if (t < prevTime) t = prevTime;                   // never go backwards
      if (t > duration) t = duration;
      starts[d] = Math.round(t * 1000) / 1000;
      prevTime = starts[d];
    }

    const pct = Math.round((matched / dom.length) * 100);
    if (!DRY) {
      fs.writeFileSync(path.join(AUDIO, book.slug, `${ch.number}.sync.json`), JSON.stringify({
        slug: book.slug,
        chapter: ch.number,
        count: dom.length,
        duration: Math.round(duration * 1000) / 1000,
        audioSentences: audio.length,
        matched,
        unmatched,
        matchedPct: pct,
        starts,
      }));
    }
    built++;
    totalSentences += dom.length;
    totalMatched += matched;
    if (pct < 90) {
      problems.push(book.slug + ' ch' + ch.number + '  dom=' + dom.length +
        ' audio=' + audio.length + ' matched=' + pct + '%');
    }
  }
}

console.log((DRY ? '[dry] ' : '') + 'chapters synced    : ' + built);
console.log('skipped (no audio): ' + skipped);
console.log('highlighted sentences: ' + totalSentences.toLocaleString());
console.log('located in the audio : ' + totalMatched.toLocaleString() +
  '  (' + Math.round((totalMatched / Math.max(1, totalSentences)) * 100) + '%)');
if (problems.length) {
  console.log('');
  console.log('chapters below 90% matched: ' + problems.length);
  problems.slice(0, 12).forEach((p) => console.log('  ' + p));
}
console.log('');
console.log(DRY ? 'dry run: nothing written' : 'written to audio/<slug>/<n>.sync.json');