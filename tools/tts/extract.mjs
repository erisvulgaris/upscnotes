// Extract chapter text from SQLite into a resumable work queue for Edge TTS.
//
// Each chapter is split into speakable "chunks" (paragraph-aligned sentences)
// because Edge TTS rejects very long utterances and a chunked design also
// lets a long chapter resume after an interruption instead of restarting.
//
// Output: audio-source.json  (checked into .gitignore — regenerated freely)

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { narrationText } from '../../src/content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'audio', 'audio-source.json');

const db = new DatabaseSync(path.join(ROOT, 'data', 'upscbooks.db'));

// narrationText() in src/content.js walks the stored section graph exactly the
// way the reader renders it, so the synthesiser never reads structural keys
// ("sec-1", "subhead", image paths) as if they were prose.

// Group sentences into chunks of at most ~700 characters. Edge TTS keeps
// prosody reasonable up to a few hundred characters; longer chunks lose
// sentence-level sync accuracy, which the fallback player depends on.
function chunkSentences(sentences, maxChars = 700) {
  const chunks = [];
  let buf = [];
  let len = 0;
  for (const s of sentences) {
    if (!s) continue;
    if (len + s.length > maxChars && buf.length) {
      chunks.push(buf.join(' '));
      buf = [];
      len = 0;
    }
    buf.push(s);
    len += s.length + 1;
  }
  if (buf.length) chunks.push(buf.join(' '));
  return chunks;
}

function toSentences(text) {
  // Keep terminal punctuation so Edge TTS pauses correctly. Split on
  // sentence-final punctuation followed by whitespace and an uppercase/quote.
  const rough = text.replace(/\s+/g, ' ').trim();
  if (!rough) return [];
  const parts = rough.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g) || [rough];
  return parts.map((s) => s.trim()).filter((s) => s.length > 1);
}

const books = db
  .prepare("SELECT id, slug, title, author, category, subject FROM books WHERE status='published' ORDER BY slug")
  .all();
const chapterQ = db.prepare('SELECT number, title, sections_json FROM chapters WHERE book_id=? ORDER BY number');

const manifest = {
  generatedAt: new Date().toISOString(),
  wordRatePerMinute: 145,
  totalChapters: 0,
  totalWords: 0,
  books: {},
};

let ci = 0;
for (const b of books) {
  const chapters = [];
  for (const c of chapterQ.all(b.id)) {
    let text = '';
    try {
      text = narrationText(JSON.parse(c.sections_json));
    } catch { text = ''; }
    const sentences = toSentences(text);
    const chunks = chunkSentences(sentences);
    const words = text.split(/\s+/).filter(Boolean).length;
    if (!chunks.length) continue;
    chapters.push({
      n: c.number,
      title: c.title,
      words,
      sentences: sentences.length,
      chunks,
      text, // kept so the app can show a transcript and re-synthesise
    });
    manifest.totalWords += words;
    ci++;
  }
  manifest.totalChapters += chapters.length;
  manifest.books[b.slug] = {
    slug: b.slug,
    title: b.title,
    author: b.author,
    category: b.category,
    subject: b.subject,
    chapters,
  };
  process.stdout.write(`  ${b.slug}: ${chapters.length} chapters\n`);
}

manifest.totalHours = Number((manifest.totalWords / manifest.wordRatePerMinute / 60).toFixed(1));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(manifest));

console.log('');
console.log(`books        ${Object.keys(manifest.books).length}`);
console.log(`chapters     ${manifest.totalChapters}`);
console.log(`words        ${manifest.totalWords.toLocaleString()}`);
console.log(`est. hours   ${manifest.totalHours}`);
console.log(`written      ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);