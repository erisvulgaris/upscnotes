// Writes audio/manifest.json from the sidecars the build produced.
//
// Without this the app has to read and parse every chapter's sidecar on the
// first request after a restart - 596 files and ~25MB of JSON, measured at
// 3.9s under load. The build already knows all of it, so it writes the index
// once and the app just reads a single file.
//
//   node tools\tts\build-manifest.mjs

import fs from 'node:fs';
import path from 'node:path';

const AUDIO = path.join('audio');
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const CH = /^[0-9]{1,5}$/;

if (!fs.existsSync(AUDIO)) {
  console.error('audio/ does not exist — run node tools\\tts\\extract.mjs first');
  process.exit(1);
}

const books = {};
let chapters = 0;
let skipped = 0;

const slugs = fs.readdirSync(AUDIO, { withFileTypes: true })
  .filter((d) => d.isDirectory() && SLUG.test(d.name))
  .map((d) => d.name);

for (const slug of slugs) {
  const dir = path.join(AUDIO, slug);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch { continue; }

  const entry = {};
  for (const f of names) {
    const n = f.replace(/\.json$/, '');
    if (!CH.test(n)) continue;
    const file = path.join(dir, f);
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    // Skip a sidecar with no audio behind it: the build writes the opus first,
    // so this only skips a chapter that was interrupted mid-write.
    if (!fs.existsSync(path.join(dir, `${n}.opus`))) { skipped++; continue; }
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* keep the size fallback */ }
    entry[n] = {
      duration: meta ? meta.duration : null,
      bytes: meta ? meta.bytes : stat.size,
      words: meta ? meta.words : null,
      sentences: meta && meta.sentenceTimings ? meta.sentenceTimings.length : 0,
      title: meta ? meta.title : null,
    };
    chapters++;
  }
  if (Object.keys(entry).length) books[slug] = entry;
}

let totalSeconds = 0;
let totalBytes = 0;
for (const slug of Object.keys(books)) {
  for (const n of Object.keys(books[slug])) {
    const c = books[slug][n];
    totalSeconds += c.duration || 0;
    totalBytes += c.bytes || 0;
  }
}

const manifest = {
  source: 'local',
  generatedAt: new Date().toISOString(),
  bookCount: Object.keys(books).length,
  chapterCount: chapters,
  totalHours: Math.round((totalSeconds / 3600) * 10) / 10,
  totalBytes,
  books,
};

fs.writeFileSync(path.join(AUDIO, 'manifest.json'), JSON.stringify(manifest));
console.log(`books    ${manifest.bookCount}`);
console.log(`chapters ${manifest.chapterCount}${skipped ? ` (${skipped} skipped: sidecar with no audio)` : ''}`);
console.log(`audio    ${(totalSeconds / 3600).toFixed(1)} hours, ${(totalBytes / 1e9).toFixed(2)} GB`);
console.log(`written audio/manifest.json (${(fs.statSync(path.join(AUDIO, 'manifest.json')).size / 1024).toFixed(1)} KB)`);