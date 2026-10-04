#!/usr/bin/env node
// Fails if any source file contains a mojibake sequence or a stray BOM.
//
// This exists because PowerShell's Set-Content silently destroys every
// non-ASCII character in a file it rewrites: the UTF-8 bytes get read as
// Latin-1 and written back out as mojibake. It cost two rounds of debugging on
// the rupee sign alone, and it also hit an em dash, an ellipsis and several
// smart quotes.
//
// Rule: any file containing non-ASCII is written with the edit tool or a Node
// script, never with Set-Content. Run this before committing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const SCAN = ['src', 'public', 'tools', 'docs'];
const SCAN_FILES = ['DESIGN.md', 'README.md'];
const EXTS = /\.(ejs|css|js|mjs|cjs|md|json|ps1|py)$/;
// Directories that hold generated or vendored content.
const SKIP = new Set(['node_modules', '.git', 'audio', 'data', 'booksrc']);

const KNOWN_BAD = [
  'â‚¹', // rupee
  'â€”', // em dash
  'â€“', // en dash
  'â€¦',  // ellipsis
  'â€™', // right single quote
  'â€œ', // left double quote
  'â€˜',  // left single quote
  'Â·',  // middot
  'Ã—',  // multiplication sign
  'Â£',  // pound
];

function walk(p, out) {
  let st;
  try { st = fs.statSync(p); } catch { return out; }
  if (st.isDirectory()) {
    if (SKIP.has(path.basename(p))) return out;
    for (const e of fs.readdirSync(p)) walk(path.join(p, e), out);
  } else if (EXTS.test(p)) {
    out.push(p);
  }
  return out;
}

const files = [];
for (const s of SCAN) walk(path.join(ROOT, s), files);
for (const f of SCAN_FILES) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) files.push(p);
}
// This file necessarily contains the very sequences it looks for.
const SELF = fileURLToPath(import.meta.url);
const scanable = files.filter((f) => path.resolve(f) !== SELF);

const problems = [];
for (const f of scanable) {
  const src = fs.readFileSync(f, 'utf8');
  if (src.charCodeAt(0) === 0xFEFF) {
    problems.push(path.relative(ROOT, f) + ': BOM at the start of the file');
  }
  src.split('\n').forEach((line, i) => {
    if (KNOWN_BAD.some((k) => line.includes(k))) {
      problems.push(path.relative(ROOT, f) + ':' + (i + 1) + '  ' + line.trim().slice(0, 90));
    }
  });
}

if (!problems.length) {
  console.log('encoding OK across ' + scanable.length + ' files');
  const home = path.join(ROOT, 'src', 'views', 'pages', 'home.ejs');
  if (fs.existsSync(home)) {
    console.log('  rupee renders as U+20B9 on the landing page: ' +
      fs.readFileSync(home, 'utf8').includes(String.fromCharCode(0x20B9)));
  }
} else {
  console.log(problems.length + ' encoding problem(s):');
  problems.forEach((p) => console.log('  ' + p));
  console.log('\nFix with a Node script or the edit tool. Never Set-Content.');
  process.exit(1);
}