import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, migrate } from '../src/db.js';
import { upsertBook, replaceChapters, setBookChapterCount } from '../src/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const MANIFEST = path.join(ROOT, 'data', 'ncert-manifest.json');

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error('Manifest not found at', MANIFEST);
    process.exit(1);
  }

  migrate();
  const manifest = loadJson(MANIFEST);
  console.log(`Manifest: ${manifest.length} books`);

  let imported = 0;
  for (const book of manifest) {
    const chapters = book.chapters.map(ch => ({
      number: ch.number,
      title: ch.title,
      sections: JSON.parse(ch.sections_json),
    }));

    const b = upsertBook({
      slug: book.slug,
      title: book.title,
      author: book.author,
      description: book.description,
      cover: '',
      color: book.color,
      category: 'ncert',
      subject: book.subject,
    });

    replaceChapters(b.id, chapters);
    setBookChapterCount(book.slug, chapters.length);
    imported++;
    console.log(`[ok] ${book.title} (${book.slug}): ${chapters.length} chapters → book #${b.id}`);
  }

  console.log(`\nDone: ${imported} books imported`);
}

main();
