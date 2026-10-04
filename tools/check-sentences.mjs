// Does sentenceList() agree with the spans renderChapter actually emits?
// They must be the same list, in the same order, or the audio timeline cannot
// be made to line up with the highlight.
import { DatabaseSync } from 'node:sqlite';
import { sentenceList, sentenceCount, renderChapter } from '../src/content.js';

const db = new DatabaseSync('data/upscbooks.db');
const books = db.prepare("SELECT id, slug FROM books WHERE status='published' ORDER BY slug").all();

let checked = 0, mismatched = 0, totalSentences = 0;
const samples = [];

for (const b of books.slice(0, 6)) {
  const chs = db.prepare('SELECT number, title, sections_json FROM chapters WHERE book_id=? ORDER BY number').all(b.id);
  for (const ch of chs.slice(0, 4)) {
    let sections;
    try { sections = JSON.parse(ch.sections_json); } catch { continue; }

    const list = sentenceList(sections);
    const count = sentenceCount(sections);
    const html = renderChapter(sections, { book: b.slug });
    const dom = [...html.matchAll(/class="tts-sent" data-sid="\d+"[^>]*>([\s\S]*?)<\/span>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .trim());

    checked++;
    totalSentences += list.length;

    let bad = 0;
    for (let i = 0; i < Math.max(list.length, dom.length); i++) {
      if (list[i] !== dom[i]) {
        bad++;
        if (samples.length < 5) {
          samples.push({
            where: b.slug + ' ch' + ch.number,
            i,
            list: (list[i] || '(none)').slice(0, 60),
            dom: (dom[i] || '(none)').slice(0, 60),
          });
        }
      }
    }
    if (bad) mismatched++;
    if (checked <= 8) {
      console.log('  ' + (b.slug + ' ch' + ch.number).padEnd(46) +
        'list=' + String(list.length).padStart(4) +
        ' dom=' + String(dom.length).padStart(4) +
        ' count=' + String(count).padStart(4) +
        ' diff=' + String(bad).padStart(4));
    }
  }
}

console.log('');
console.log('chapters checked : ' + checked);
console.log('chapters with any difference : ' + mismatched);
console.log('total sentences  : ' + totalSentences);
if (samples.length) {
  console.log('');
  console.log('first differences:');
  for (const s of samples) {
    console.log('  ' + s.where + ' [' + s.i + ']');
    console.log('    list: ' + s.list);
    console.log('    dom : ' + s.dom);
  }
}
console.log(mismatched === 0
  ? 'OK: sentenceList is exactly what the reader highlights'
  : 'MISMATCH: the timeline would still be wrong');