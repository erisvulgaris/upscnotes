// Is the cached audio for chapter N actually chapter N? The sync test found
// "Chapter 4" being spoken while chapter 3's text was highlighted.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sentenceList, narrationText } from '../src/content.js';

const db = new DatabaseSync('data/upscnotes.db');

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const PAIRS = [
  ['history-themes-in-world-history', 3],
  ['history-themes-in-world-history', 4],
  ['modern-indian-history', 24],
  ['modern-indian-history', 25],
  ['indian-polity', 53],
];

for (const [slug, n] of PAIRS) {
  const b = db.prepare('SELECT id FROM books WHERE slug=?').get(slug);
  if (!b) { console.log(slug + ': no such book'); continue; }
  const ch = db.prepare('SELECT number, title, sections_json FROM chapters WHERE book_id=? AND number=?').get(b.id, n);
  const sidePath = path.join('audio', slug, n + '.json');
  if (!ch) { console.log(slug + ' ch' + n + ': NOT IN THE DATABASE'); continue; }
  if (!fs.existsSync(sidePath)) { console.log(slug + ' ch' + n + ': no sidecar'); continue; }

  const side = JSON.parse(fs.readFileSync(sidePath, 'utf8'));
  const dom = sentenceList(JSON.parse(ch.sections_json));
  const spoken = (side.sentenceTimings || []).map((x) => x.text);

  // Which chapter does the audio actually belong to?
  const audioAll = norm(spoken.join(' ')).slice(0, 4000);
  let best = null;
  const chs = db.prepare('SELECT number, title, sections_json FROM chapters WHERE book_id=? ORDER BY number').all(b.id);
  for (const c of chs) {
    const list = sentenceList(JSON.parse(c.sections_json));
    if (!list.length) continue;
    const probe = norm(list.slice(0, 6).join(' '));
    if (probe.length > 40 && audioAll.indexOf(probe) !== -1) { best = c.number; break; }
  }

  const firstSpoken = norm(spoken[0] || '').slice(0, 70);
  const firstDom = norm(dom[0] || '').slice(0, 70);
  console.log(slug + ' ch' + n + '  "' + ch.title + '"');
  console.log('   db first sentence : ' + firstDom);
  console.log('   audio first       : ' + firstSpoken);
  console.log('   audio actually is chapter ' + (best === null ? 'UNKNOWN' : best) +
    (best !== null && best !== n ? '   <-- MISMATCH' : '   ok'));
  console.log('');
}