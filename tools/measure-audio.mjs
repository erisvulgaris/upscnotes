import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/upscnotes.db');

const books = db.prepare("SELECT id, slug, title, category, subject, chapter_count FROM books WHERE status='published'").all();
const q = db.prepare('SELECT number, title, sections_json FROM chapters WHERE book_id=? ORDER BY number');

function textOf(json) {
  try {
    const parsed = JSON.parse(json);
    const out = [];
    (function walk(node) {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node === 'string') { out.push(node); return; }
      if (typeof node !== 'object') return;
      if (typeof node.text === 'string') { out.push(node.text); return; }
      for (const k of Object.keys(node)) walk(node[k]);
    })(parsed);
    return out.join(' ');
  } catch { return ''; }
}

let grandChapters = 0, grandWords = 0, thin = 0;
const rows = [];
for (const b of books) {
  const chs = q.all(b.id);
  let words = 0, sents = 0, low = 0;
  for (const c of chs) {
    const t = textOf(c.sections_json);
    const w = t.split(/\s+/).filter(Boolean).length;
    if (w < 40) low++;
    words += w;
    sents += (t.match(/[.!?]/g) || []).length;
  }
  grandChapters += chs.length;
  grandWords += words;
  thin += low;
  rows.push({ slug: b.slug, cat: b.category, chapters: chs.length, words, sents });
}

rows.sort((a, b) => b.words - a.words);
console.log('books=' + rows.length + '  chapters=' + grandChapters + '  words=' + grandWords.toLocaleString());
console.log('audio minutes @145wpm: ' + Math.round(grandWords / 145));
console.log('audio hours:           ' + (grandWords / 145 / 60).toFixed(1));
console.log('size @24kbps 16k Opus: ' + (grandWords / 145 * 60 * 24000 / 8 / 1e9).toFixed(1) + ' GB');
console.log('chapters under 40 words: ' + thin);
console.log('');
console.log('slug'.padEnd(46) + '  ch' + '  words' + '  min' + '  avg words/ch');
for (const r of rows) {
  console.log(r.slug.slice(0, 45).padEnd(46) + String(r.chapters).padStart(4) +
    r.words.toLocaleString().padStart(9) + String(Math.round(r.words / 145)).padStart(6) +
    String(Math.round(r.words / Math.max(1, r.chapters))).padStart(9));
}