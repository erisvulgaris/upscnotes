import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/upscbooks.db');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('--- tables ---');
for (const t of tables) console.log('  ' + t.name);

for (const t of ['subscriptions', 'orders', 'users']) {
  console.log('\n--- ' + t + ' ---');
  for (const c of db.prepare('PRAGMA table_info(' + t + ')').all()) {
    console.log('  ' + c.name.padEnd(24) + c.type + (c.notnull ? ' NOT NULL' : '') + (c.dflt_value ? ' default ' + c.dflt_value : ''));
  }
}

console.log('\n--- sample subscriptions ---');
console.log(JSON.stringify(db.prepare('SELECT * FROM subscriptions LIMIT 3').all(), null, 1));

console.log('\n--- counts ---');
for (const t of ['users', 'subscriptions', 'orders']) {
  try {
    console.log('  ' + t + ': ' + db.prepare('SELECT COUNT(*) n FROM ' + t).get().n);
  } catch { console.log('  ' + t + ': missing'); }
}

try {
  console.log('\n--- settings ---');
  for (const r of db.prepare('SELECT * FROM settings').all()) console.log('  ' + JSON.stringify(r));
} catch {
  console.log('\n--- settings ---');
  console.log('  no settings table');
}