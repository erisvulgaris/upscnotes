import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, migrate } from '../src/db.js';
import { upsertBook, replaceChapters, setBookChapterCount } from '../src/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const EBOOKS_DIR = path.join(ROOT, 'data', 'ebooks');

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  if (!fs.existsSync(EBOOKS_DIR)) {
    console.error('No ebooks dir at', EBOOKS_DIR);
    process.exit(1);
  }
  migrate();

  const files = fs.readdirSync(EBOOKS_DIR).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) {
    console.log('No ebook manifests found.');
    return;
  }

  let imported = 0;
  for (const f of files) {
    const manifest = loadJson(path.join(EBOOKS_DIR, f));

    const chapters = (manifest.chapters || []).map((ch) => ({
      number: ch.number,
      title: ch.title,
      sections: JSON.parse(ch.sections_json),
    }));

    const b = upsertBook({
      slug: manifest.slug,
      title: manifest.title,
      author: manifest.author,
      description: manifest.description,
      cover: '',
      color: manifest.color,
      category: 'textbook',
      subject: manifest.subject,
    });

    replaceChapters(b.id, chapters);
    setBookChapterCount(manifest.slug, chapters.length);
    imported++;
    console.log(`[ok] ${manifest.title} (${manifest.slug}): ${chapters.length} chapters → book #${b.id}`);
  }

  console.log(`\nDone: ${imported} books imported`);
}

main();