import { Router } from 'express';
import { renderPage } from '../render.js';
import { listBooks, listBooksByCategory } from '../model.js';

const router = Router();

router.get('/', (req, res) => {
  const books = listBooks().filter((b) => b.status === 'published');
  const ncertCount = listBooksByCategory('ncert').length;
  renderPage(res, 200, 'home', { title: 'Civil services book library', books, ncertCount });
});

router.get('/ncerts', (req, res) => {
  const ncerts = listBooksByCategory('ncert');
  // Group by subject
  const subjects = {};
  for (const b of ncerts) {
    const subj = b.subject || 'Other';
    if (!subjects[subj]) subjects[subj] = [];
    subjects[subj].push(b);
  }
  renderPage(res, 200, 'ncerts', { title: 'NCERT Textbooks', subjects });
});

export default router;