import { Router } from 'express';
import { renderPage } from '../render.js';
import { listBooks } from '../model.js';

const router = Router();

router.get('/', (req, res) => {
  const books = listBooks().filter((b) => b.status === 'published');
  renderPage(res, 200, 'home', { title: 'Civil services book library', books });
});

export default router;