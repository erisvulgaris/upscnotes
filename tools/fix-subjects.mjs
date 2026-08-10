import { db } from '../src/db.js';

const fixes = [
  { slug: 'indian-polity', subject: 'Political Science' },
  { slug: 'modern-indian-history', subject: 'History' },
  { slug: 'spectrum-modern-india', subject: 'History' },
];

const upd = db.prepare('UPDATE books SET subject = ? WHERE slug = ?');
let n = 0;
for (const f of fixes) {
  const r = upd.run(f.subject, f.slug);
  n += r.changes;
}
const econ = db.prepare("UPDATE books SET subject = 'Economics' WHERE subject = 'Economy'").run();
n += econ.changes;

console.log(`Subject fixes applied: ${n} row(s) updated.`);