import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const db = new DatabaseSync(path.join('data', 'upscbooks.db'));
const prov = JSON.parse(fs.readFileSync(path.join('covers', 'provenance.json'), 'utf8'));

let updated = 0;
for (const [slug, entry] of Object.entries(prov)) {
  if (entry.found) {
    db.prepare('UPDATE books SET cover = ? WHERE slug = ?').run('jpg', slug);
    updated++;
  }
}

console.log('Updated', updated, 'books with covers');
