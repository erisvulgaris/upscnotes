// Integrity check across every built chapter, not a sample: does each .opus
// have a sidecar, does each sidecar parse, are its timings monotonic and
// inside its duration, and does the container start with the OggS magic?
import fs from 'node:fs';
import path from 'node:path';

const AUDIO = path.join('audio');
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const CH = /^[0-9]{1,5}$/;

const problems = [];
let chapters = 0, totalBytes = 0, totalSeconds = 0, totalSentences = 0;
let missingSidecar = 0, orphanSidecar = 0, badMagic = 0, badJson = 0, nonMono = 0;
let notMonotonic = 0, outsideDuration = 0, zeroLength = 0, emptyTimings = 0;

const books = fs.readdirSync(AUDIO, { withFileTypes: true })
  .filter((d) => d.isDirectory() && SLUG.test(d.name))
  .map((d) => d.name)
  .sort();

for (const slug of books) {
  const dir = path.join(AUDIO, slug);
  const files = fs.readdirSync(dir);
  const opus = new Set(files.filter((f) => f.endsWith('.opus')));
  const sides = files.filter((f) => f.endsWith('.json') && CH.test(f.replace(/\.json$/, '')));

  for (const n of opus) {
    chapters++;
    const base = n.replace(/\.opus$/, '');
    const side = base + '.json';
    if (!sides.includes(side)) { missingSidecar++; problems.push(`${slug}/${n}: no sidecar`); continue; }

    const op = path.join(dir, n);
    const st = fs.statSync(op);
    totalBytes += st.size;
    if (st.size < 512) { zeroLength++; problems.push(`${slug}/${n}: ${st.size} bytes`); }

    // Ogg container magic, read straight from disk rather than over HTTP.
    const fd = fs.openSync(op, 'r');
    const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    if (head.toString('latin1') !== 'OggS') badMagic++;

    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, side), 'utf8')); }
    catch { badJson++; problems.push(`${slug}/${n}: sidecar will not parse`); continue; }

    const dur = meta.duration || 0;
    totalSeconds += dur;
    const T = meta.sentenceTimings || [];
    totalSentences += T.length;
    if (!T.length) { emptyTimings++; problems.push(`${slug}/${n}: no sentence timings`); }

    let mono = true;
    for (let i = 1; i < T.length; i++) if (T[i].t < T[i - 1].t) { mono = false; break; }
    if (!mono) { notMonotonic++; problems.push(`${slug}/${n}: timings not monotonic`); }

    const last = T.length ? T[T.length - 1].t : 0;
    if (dur > 0 && (last > dur + 2 || T[0] && T[0].t < 0)) {
      outsideDuration++;
      problems.push(`${slug}/${n}: timings outside duration (last=${last.toFixed(1)} dur=${dur.toFixed(1)})`);
    }
    // A single sentence spanning most of the chapter means interpolation is
    // too coarse to be useful for highlighting.
    if (T.length && dur > 0) {
      const mean = dur / T.length;
      if (mean > 15) problems.push(`${slug}/${n}: mean sentence ${mean.toFixed(1)}s`);
    }
  }

  for (const s of sides) {
    if (!opus.has(s.replace(/\.json$/, '.opus'))) {
      orphanSidecar++;
      problems.push(`${slug}/${s}: sidecar with no audio`);
    }
  }
}

const gb = (totalBytes / 1e9).toFixed(2);
console.log('books              ' + books.length);
console.log('chapters           ' + chapters);
console.log('audio              ' + (totalSeconds / 3600).toFixed(1) + ' hours, ' + gb + ' GB');
console.log('avg chapter        ' + (totalSeconds / Math.max(1, chapters) / 60).toFixed(1) + ' min');
console.log('avg size           ' + (totalBytes / Math.max(1, chapters) / 1024).toFixed(0) + ' KB');
console.log('sentence timings   ' + totalSentences.toLocaleString() +
  '  (mean ' + (totalSeconds / Math.max(1, totalSentences)).toFixed(2) + 's apart)');
console.log('');
console.log('missing sidecar    ' + missingSidecar);
console.log('orphan sidecar     ' + orphanSidecar);
console.log('bad OggS magic     ' + badMagic);
console.log('unparseable        ' + badJson);
console.log('non-monotonic      ' + notMonotonic);
console.log('outside duration   ' + outsideDuration);
console.log('suspiciously small  ' + zeroLength);
console.log('no timings         ' + emptyTimings);
console.log('');
console.log(problems.length === 0 ? 'NO PROBLEMS' : problems.length + ' issue(s):');
problems.slice(0, 25).forEach((p) => console.log('  ' + p));
if (problems.length > 25) console.log('  ... and ' + (problems.length - 25) + ' more');