// Production seed builder: copies the current SQLite DB to seed/upscbooks.db and
// scrubs dev-only test users so the production DB ships clean. Run AFTER
// importing books locally. Output: seed/upscbooks.db (no WAL/shm files).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'upscbooks.db');
const SEED_DIR = path.join(ROOT, 'seed');
const DST = path.join(SEED_DIR, 'upscbooks.db');

if (!fs.existsSync(SRC)) { console.error('no db at', SRC); process.exit(1); }

// 1) Flush WAL into the main file so a plain file copy is complete.
const src = new DatabaseSync(SRC);
src.exec('PRAGMA wal_checkpoint(TRUNCATE);');
src.close();

// 2) Copy the now-consistent DB file (no -wal/-shm needed).
fs.mkdirSync(SEED_DIR, { recursive: true });
fs.copyFileSync(SRC, DST);
fs.rmSync(DST + '-wal', { force: true });
fs.rmSync(DST + '-shm', { force: true });

// 3) Scrub dev/smoke users from the copy.
const db = new DatabaseSync(DST);
const info = db.prepare(
  "DELETE FROM users WHERE email LIKE 'reader%' OR email LIKE '%@test%' OR email LIKE '%@t.com'"
).run();
db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
db.close();
console.log(`seed ok -> ${DST} (removed ${info.changes} users)`);