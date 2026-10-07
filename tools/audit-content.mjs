// Content QA. Finds typographic artefacts in the stored chapter text.
//
// These are NOT auto-fixed: this is published textbook prose, and quietly
// rewriting a book's wording is not a UI change. The tool writes a report so
// the content owner can decide, and prints the counts.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/upscnotes.db');
const q = db.prepare(
  'SELECT c.number, c.sections_json, b.slug, b.title FROM chapters c JOIN books b ON b.id = c.book_id'
);

const RULES = [
  {
    id: 'no-space-before-bracket',
    label: 'Word glued to a parenthetical year: "Bijapur(1489-86)"',
    re: /[A-Za-z\u0900-\u097F]{3,}\((?=[12]\d{3}|\d{4}-\d{2})/g,
  },
  {
    id: 'name-glued-to-number',
    label: 'Place name glued to a number: "Orissa1."',
    re: /[a-z]{4,}(?=\d{1,2}\s*[.)])/g,
  },
  {
    id: 'glued-list-marker',
    label: 'List marker glued to its text: "1.The Crown" (digit, period, capital, no space)',
    re: /\b\d{1,2}\.(?=[A-Z][a-z])/g,
  },
  {
    id: 'falsy-section-number',
    label: 'Section stored with a falsy number, so the heading needs no number at all',
    section: true,
  },
];

// Must mirror src/content.js narrationText: take run text and section titles
// only. A naive walk over every key also picks up `kind: 'para'` and the block
// kind strings, which inflates every count and invents matches like
// "para 2.There".
function walkText(sections) {
  const out = [];
  for (const sec of (sections || [])) {
    const title = (sec.title || '').trim();
    if (title) out.push(title);
    for (const b of (sec.blocks || [])) {
      switch (b.kind) {
        case 'para':
        case 'subhead':
        case 'note':
        case 'alert': {
          const t = (b.runs || []).map((r) => r.text || '').join('').trim();
          if (t) out.push(t);
          break;
        }
        case 'table': {
          const push = (cells) => {
            for (const c of (cells || [])) {
              const t = (c.runs || []).map((r) => r.text || '').join('').trim();
              if (t) out.push(t);
            }
          };
          if (b.head) push(b.head.cells);
          for (const tr of (b.rows || [])) {
            if (Array.isArray(tr)) push(tr); else push(tr && tr.cells);
          }
          break;
        }
        case 'image': {
          const cap = (b.caption_runs || b['caption_runs'] || []).map((r) => r.text || '').join('').trim();
          if (cap) out.push(cap);
          break;
        }
        default: break;
      }
    }
  }
  return out.join(' ');
}

const findings = new Map(RULES.map((r) => [r.id, []]));
let chapters = 0;

for (const row of q.all()) {
  chapters++;
  let parsed;
  try { parsed = JSON.parse(row.sections_json); } catch { continue; }
  const where = `${row.slug} ch${row.number}`;

  for (const r of RULES) {
    if (r.section) {
      const bad = (parsed || []).filter((s) => s.num === 0 || s.num === '' || s.num == null);
      if (bad.length) findings.get(r.id).push({ where, detail: bad.length + ' section(s)' });
      continue;
    }
    const text = walkText(parsed);
    r.re.lastIndex = 0;
    const m = text.match(r.re);
    if (!m) continue;
    for (const hit of m.slice(0, 5)) {
      const i = text.indexOf(hit);
      findings.get(r.id).push({
        where,
        hit,
        context: text.slice(Math.max(0, i - 40), i + 45).replace(/\s+/g, ' ').trim(),
      });
    }
  }
}

const OUT = path.join('audio', 'content-qa-report.json');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

let total = 0;
console.log('chapters scanned: ' + chapters + '\n');
const report = {};
for (const r of RULES) {
  const hits = findings.get(r.id);
  total += hits.length;
  report[r.id] = { label: r.label, count: hits.length, hits: hits.slice(0, 40) };
  console.log(`${r.label}`);
  console.log(`  ${hits.length} occurrence(s)`);
  hits.slice(0, 5).forEach((h) => console.log(`    ${h.where}  "${h.context}"`));
  if (hits.length > 5) console.log(`    …and ${hits.length - 5} more`);
  console.log('');
}
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), chapters, total, rules: report }, null, 2));
console.log(`total: ${total}`);
console.log(`report: ${OUT}`);
console.log('Nothing was modified — these are textbook prose and the content owner decides.');