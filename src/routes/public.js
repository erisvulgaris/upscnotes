import { Router } from 'express';
import { renderPage } from '../render.js';
import { listBooks, listBooksByCategory } from '../model.js';

const router = Router();

router.get('/', (req, res) => {
  const all = listBooks().filter((b) => b.status === 'published');
  const ncerts = listBooksByCategory('ncert');
  const textbooks = all.filter((b) => b.category !== 'ncert');
  const featured = textbooks.slice(0, 8);
  const ncertCount = ncerts.length;
  const totalBooks = all.length;
  const totalChapters = all.reduce((s, b) => s + (b.chapter_count || 0), 0);
  const subjects = [...new Set(all.map((b) => (b.subject || '').trim()).filter(Boolean))];
  renderPage(res, 200, 'home', {
    title: 'Civil services book library',
    books: featured,
    textbooks,
    ncertCount,
    totalBooks,
    allChapters: totalChapters,
    subjects,
  });
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