import ejs from 'ejs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS = path.join(__dirname, 'views');

// renderPage: render an inner page template, then wrap it in layout.ejs.
export function renderPage(res, status, page, locals = {}) {
  const merged = {
    csrf: '',
    path: '/',
    user: null,
    isAdmin: false,
    hasSub: false,
    ...(res.locals || {}),
    ...locals,
  };
  merged.getYear = () => new Date().getFullYear();

  const partialPath = path.join(VIEWS, 'pages', page + '.ejs');
  const body = ejs.render(fs.readFileSync(partialPath, 'utf8'), merged, { filename: partialPath });

  const layoutPath = path.join(VIEWS, 'layout.ejs');
  const html = ejs.render(fs.readFileSync(layoutPath, 'utf8'), { ...merged, body }, { filename: layoutPath });
  res.status(status).send(html);
}