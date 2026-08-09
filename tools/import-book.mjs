import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, migrate } from '../src/db.js';
import { upsertBook, replaceChapters, getBookById, setBookChapterCount } from '../src/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ---- Book registry: where each book's source JSON lives. ----
// Reuse the existing build pipelines' source data (identical chapter schema).
const BOOKS = [
  {
    slug: 'indian-polity',
    title: 'Indian Polity',
    author: 'M. Laxmikanth',
    description: 'The complete, chapter-by-chapter Indian Polity textbook with quizzes, flashcards, and text-to-speech.',
    color: '#305496',
    dataDir: path.join(ROOT, '..', 'polity', 'data', 'polity'),
    assetsDir: path.join(ROOT, '..', 'polity-site', 'assets'),   // fonts, app.css, reader/tts js etc (shared)
  },
  {
    slug: 'modern-indian-history',
    title: 'Modern Indian History',
    author: 'Himanshu Khatri',
    description: 'Exam-oriented Modern Indian History notes by Vision IAS faculty with quizzes, flashcards, and practice questions.',
    color: '#8B2500',
    dataDir: path.join(ROOT, '..', 'offline', 'data', 'mih'),
    assetsDir: path.join(ROOT, '..', 'offline-site', 'assets'),
  },
  {
    slug: 'spectrum-modern-india',
    title: 'A Brief History of Modern India',
    author: 'Rajiv Ahir',
    description: 'The full Spectrum 2019-20 edition — the complete, chapter-by-chapter Modern India textbook with text-to-speech.',
    color: '#1E3A5F',
    dataDir: path.join(ROOT, '..', 'spectrum', 'data', 'spectrum'),
    assetsDir: null,
  },
];

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function importBook(cfg) {
  const manifestPath = path.join(cfg.dataDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`No manifest.json at ${manifestPath}`);
  const manifest = loadJson(manifestPath);

  // Resolve the assets folder (fonts / images / maps) from the source site dir.
  const assetsRoot = cfg.assetsDir || path.join(path.dirname(cfg.dataDir), 'offline-site', 'assets');
  cfg.assetsDir = assetsRoot;

  const chaptersDir = path.join(cfg.dataDir, 'chapters');
  const chapterFiles = fs.readdirSync(chaptersDir)
    .filter(f => /^ch\d+\.json$/i.test(f))
    .sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));

  const chapters = chapterFiles.map(f => {
    const num = +f.match(/\d+/)[0];
    const data = loadJson(path.join(chaptersDir, f));
    return {
      number: num,
      title: data.title || `Chapter ${num}`,
      sections: data.sections || [],
    };
  });

  const book = upsertBook({
    slug: cfg.slug,
    title: cfg.title,
    author: cfg.author,
    description: cfg.description,
    cover: '',          // placeholder cover used until an image is uploaded
    color: cfg.color,
  });
  replaceChapters(book.id, chapters);
  setBookChapterCount(cfg.slug, chapters.length);

    // Stash supporting JSON for the reader/nav under content/<slug>.
    const bookContentDir = path.join(ROOT, 'content', cfg.slug);
    fs.mkdirSync(bookContentDir, { recursive: true });
    fs.writeFileSync(path.join(bookContentDir, 'manifest.json'), JSON.stringify(manifest, null, 0));
    for (const name of ['questions.json', 'flashcards.json', 'mindmaps.json', 'palette_terms.json',
      'mains_bank.json', 'mains_frameworks.json', 'sections_text.json', 'search_index.json',
      'maps.json', 'map_pyqs.json', 'timeline.json']) {
      const src = path.join(cfg.dataDir, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(bookContentDir, name));
    }
    // Copy book media (images / maps) so figures render behind the auth gate.
    for (const dir of ['assets/images', 'assets/image', 'assets/maps', 'assets/map']) {
      const srcDir = path.join(cfg.assetsDir || '', '..', dir);
      const relDir = dir.replace(/^assets\//, '');
      if (fs.existsSync(srcDir)) {
        const dstDir = path.join(bookContentDir, relDir);
        copyDir(srcDir, dstDir);
      }
    }

    console.log(`[ok] ${cfg.title} (${cfg.slug}): imported ${chapters.length} chapters into book #${book.id}`);
}

function main() {
  migrate();
  const targets = process.argv.slice(2); // optional slug filters
  const toImport = BOOKS.filter(b => !targets.length || targets.includes(b.slug));
  for (const cfg of toImport) importBook(cfg);
}

main();
