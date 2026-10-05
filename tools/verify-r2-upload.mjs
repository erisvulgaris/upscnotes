// Compares what is in the bucket against what is on disk, per book, so a
// partial upload cannot pass as a finished one.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
Object.assign(process.env, {
  RCLONE_CONFIG_UP_TYPE: 's3',
  RCLONE_CONFIG_UP_PROVIDER: 'Cloudflare',
  RCLONE_CONFIG_UP_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
  RCLONE_CONFIG_UP_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
  RCLONE_CONFIG_UP_ENDPOINT: env.R2_ENDPOINT,
  RCLONE_CONFIG_UP_REGION: 'auto',
});

const remote = 'up:' + env.R2_BUCKET;

function rclone(args) {
  return execFileSync('rclone', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// --- remote inventory --------------------------------------------------
const json = rclone(['lsjson', remote, '--recursive', '--files-only', '--no-modtime', '--no-mimetype']);
const remoteFiles = JSON.parse(json);
const remoteByBook = new Map();
let remoteBytes = 0;
let remoteRootFiles = 0;
for (const f of remoteFiles) {
  remoteBytes += f.Size || 0;
  const parts = f.Path.split('/');
  // Objects written at the bucket root have no directory, and treating the
  // filename as a book name reported manifest.json as a missing book.
  if (parts.length < 2) { remoteRootFiles++; continue; }
  const book = parts[0];
  if (!remoteByBook.has(book)) remoteByBook.set(book, { opus: 0, json: 0, bytes: 0 });
  const e = remoteByBook.get(book);
  if (f.Path.endsWith('.opus')) e.opus++;
  else e.json++;
  e.bytes += f.Size || 0;
}

// --- local inventory ---------------------------------------------------
const AUDIO = path.join('audio');
const localBooks = fs.readdirSync(AUDIO, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'logs').map((d) => d.name);

let localOpus = 0, localBytes = 0, missingOpus = 0, missingSide = 0, missingSync = 0;
const problems = [];

for (const book of localBooks) {
  const dir = path.join(AUDIO, book);
  const files = fs.readdirSync(dir);
  const want = {
    opus: files.filter((f) => f.endsWith('.opus')).length,
    json: files.filter((f) => f.endsWith('.json')).length,
    bytes: files.filter((f) => f.endsWith('.opus'))
      .reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0),
  };
  localOpus += want.opus;
  localBytes += want.bytes;

  const have = remoteByBook.get(book);
  if (!have) {
    problems.push(`${book}: absent from the bucket`);
    missingOpus += want.opus;
    missingSide += want.json;
    continue;
  }
  if (have.opus !== want.opus) {
    problems.push(`${book}: ${have.opus} opus in bucket, ${want.opus} on disk`);
    missingOpus += Math.abs(want.opus - have.opus);
  }
  if (have.json !== want.json) {
    problems.push(`${book}: ${have.json} json in bucket, ${want.json} on disk`);
    missingSide += Math.abs(want.json - have.json);
  }
}

for (const book of remoteByBook.keys()) {
  if (!localBooks.includes(book)) problems.push(`${book}: in the bucket but not on disk`);
}

const remoteOpus = [...remoteByBook.values()].reduce((s, e) => s + e.opus, 0);
const remoteJson = [...remoteByBook.values()].reduce((s, e) => s + e.json, 0);
const localJson = localBooks.reduce((s, b) => s + fs.readdirSync(path.join(AUDIO, b)).filter((f) => f.endsWith('.json')).length, 0);

console.log('books on disk        : ' + localBooks.length);
console.log('books in bucket     : ' + remoteByBook.size);
console.log('opus on disk        : ' + localOpus + '  (' + (localBytes / 1e9).toFixed(2) + ' GB)');
console.log('opus in bucket      : ' + remoteOpus + '  (' + (remoteBytes / 1e9).toFixed(2) + ' GB incl. json)');
console.log('json on disk        : ' + localJson);
console.log('json in bucket      : ' + remoteJson);
console.log('root files in bucket: ' + remoteRootFiles + ' (manifest.json and reports, not chapters)');
console.log('');
if (problems.length) {
  console.log('PROBLEMS (' + problems.length + '):');
  problems.slice(0, 25).forEach((p) => console.log('  ' + p));
  process.exitCode = 1;
} else {
  console.log('COMPLETE: every chapter and sidecar on disk is in the bucket, counts agree');
}