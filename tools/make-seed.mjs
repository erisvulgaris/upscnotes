// Production seed builder: copies the current SQLite DB to seed/upscnotes.db and
// scrubs dev-only test users so the production DB ships clean. Run AFTER
// importing books locally. Output: seed/upscnotes.db (no WAL/shm files).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'upscnotes.db');
const SEED_DIR = path.join(ROOT, 'seed');
const DST = path.join(SEED_DIR, 'upscnotes.db');

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

// 3) Ship only the admin accounts.
//
// Anything else in a local DB is either a throwaway QA fixture (reader*, *@test*,
// qa*, pricing-*@example.test) or a real person who signed up locally. Neither
// belongs in a production image: the fixtures are noise, and a personal row
// copied into a public deployment leaks an account that was never meant to
// exist there. Real members are created by signing up on the live site.
const db = new DatabaseSync(DST);
const removed = db.prepare('SELECT email FROM users WHERE role <> ? ORDER BY email').all('admin');
const info = db.prepare('DELETE FROM users WHERE role <> ?').run('admin');
db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
db.close();

const kept = removed.length - info.changes;
console.log(`seed ok -> ${DST}`);
console.log(`  books+chapters copied from ${SRC}`);
console.log(`  removed ${info.changes} non-admin user(s)${kept ? ` (${kept} listed but unaffected)` : ''}`);
if (removed.length) {
  console.log('  removed: ' + removed.map((u) => u.email).join(', '));
}