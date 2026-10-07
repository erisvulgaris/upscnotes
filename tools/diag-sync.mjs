// Why do no sentences match between the cached sidecar and the reader?
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sentenceList } from '../src/content.js';

const db = new DatabaseSync('data/upscnotes.db');
const book = db.prepare("SELECT id, slug FROM books WHERE slug='economics'").get();
const ch = db.prepare('SELECT number, sections_json FROM chapters WHERE book_id=? AND number=1').get(book.id);

const dom = sentenceList(JSON.parse(ch.sections_json));
const side = JSON.parse(fs.readFileSync(path.join('audio', book.slug, '1.json'), 'utf8'));
const audio = side.sentenceTimings || [];

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

console.log('DOM   ' + dom.length + ' sentences, audio ' + audio.length + '\n');
console.log('--- first 5 DOM (what gets highlighted) ---');
dom.slice(0, 5).forEach((t, i) => console.log('  [' + i + '] ' + JSON.stringify(t.slice(0, 96))));
console.log('\n--- first 5 AUDIO (what gets spoken) ---');
audio.slice(0, 5).forEach((t, i) => console.log('  [' + i + '] t=' + t.t + ' ' + JSON.stringify((t.text || '').slice(0, 96))));

console.log('\n--- normalised comparison ---');
for (let i = 0; i < 5; i++) {
  const d = norm(dom[i]);
  const a = norm(audio[i] && audio[i].text);
  console.log('  [' + i + '] dom=' + JSON.stringify(d.slice(0, 60)));
  console.log('       aud=' + JSON.stringify(a.slice(0, 60)));
  console.log('       equal=' + (d === a) + '  domLen=' + d.length + ' audLen=' + a.length);
}

// Is the audio stream a superset? Check whether every DOM sentence appears
// somewhere in the audio stream at all.
const haystack = ' ' + norm(audio.map((x) => x.text).join(' ')).replace(/\s+/g, ' ') + ' ';
let found = 0;
for (const t of dom) {
  const n = norm(t);
  if (n && haystack.indexOf(n) !== -1) found++;
}
console.log('\nDOM sentences found verbatim in the audio stream: ' + found + ' / ' + dom.length +
  '  (' + Math.round((found / dom.length) * 100) + '%)');