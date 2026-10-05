import ejs from 'ejs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverUrl as _coverUrl } from './cover.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS = path.join(__dirname, 'views');

// Templates are read from disk and handed to ejs on every single request,
// which meant two fs reads plus two full parses per page view. Cache the
// compiled functions keyed by file mtime so an edit during development still
// picks up immediately.
const cache = new Map(); // absPath -> { mtimeMs, fn }

function template(absPath) {
  let src;
  try {
    src = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    return null;
  }
  const stat = fs.statSync(absPath);
  const hit = cache.get(absPath);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.fn;
  const fn = ejs.compile(src, { filename: absPath, rmWhitespace: false });
  cache.set(absPath, { mtimeMs: stat.mtimeMs, fn });
  return fn;
}

// Defaults every template can rely on. `exCss` / `exJs` are intentionally
// absent so views can test `typeof x !== 'undefined'` to opt in.
export function renderPage(res, status, page, locals = {}) {
  const merged = {
    csrf: '',
    path: '/',
    title: 'UPSCbooks',
    user: null,
    isAdmin: false,
    hasSub: false,
    metaDesc: undefined,
    ...(res.locals || {}),
    ...locals,
  };
  merged.getYear = () => new Date().getFullYear();
  merged.coverUrl = (slug) => _coverUrl(slug);

  const partialPath = path.join(VIEWS, 'pages', page + '.ejs');
  const bodyFn = template(partialPath);
  if (!bodyFn) {
    console.error('view not found:', partialPath);
    return res.status(500).type('text/plain').send('Template not found: ' + page);
  }

  let body;
  try {
    body = bodyFn(merged);
  } catch (e) {
    console.error('template render failed:', page, e.message);
    return res.status(500).type('text/plain').send('Template error');
  }

  const layoutPath = path.join(VIEWS, 'layout.ejs');
  const layoutFn = template(layoutPath);
  if (!layoutFn) {
    return res.status(500).type('text/plain').send('Layout not found');
  }

  res.status(status).type('html').send(layoutFn({ ...merged, body }));
}