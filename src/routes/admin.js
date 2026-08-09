import { Router } from 'express';
import { requireAdmin } from '../middleware.js';
import { renderPage } from '../render.js';
import {
  listUsers, countUsers, countActiveSubs, listPayments, sumCaptured,
  listBooks, activateForUserByAdmin, setSubscriptionStatus, getActiveSubscription,
} from '../model.js';

const router = Router();

const RUPEE = (p) => '₹' + ((p || 0) / 100).toLocaleString('en-IN');

router.use(requireAdmin);

router.get('/', (req, res) => {
  const totalUsers = countUsers();
  const payments = listPayments();
  renderPage(res, 200, 'admin/overview', {
    title: 'Admin · Overview',
    active: 'overview',
    stats: {
      users: totalUsers,
      admins: listUsers().filter((u) => u.role === 'admin').length,
      active_subs: countActiveSubs(),
      revenue: RUPEE(sumCaptured()),
      orders: payments.length,
      captured: payments.filter((p) => p.status === 'captured').length,
      books: listBooks().length,
    },
    recentPayments: payments.slice(0, 6),
    RUPEE,
  });
});

router.get('/users', (req, res) => {
  const users = listUsers().map((u) => ({
    ...u,
    active_sub: getActiveSubscription(u.id) || null,
  }));
  renderPage(res, 200, 'admin/users', { title: 'Admin · Members', active: 'users', users });
});

router.get('/payments', (req, res) => {
  renderPage(res, 200, 'admin/payments', {
    title: 'Admin · Payments', active: 'payments', payments: listPayments(), RUPEE,
  });
});

router.get('/books', (req, res) => {
  renderPage(res, 200, 'admin/books', { title: 'Admin · Books', active: 'books', books: listBooks() });
});

// Grant a member lifetime access (admin-comped).
router.post('/users/:id/grant', (req, res) => {
  const id = Number(req.params.id);
  if (id && !isNaN(id) && Number(id) !== req.session.userId) {
    activateForUserByAdmin(id, 0);
  }
  res.redirect('/admin/users');
});

// Revoke a member's access (marks active subs lapsed).
router.post('/users/:id/revoke', (req, res) => {
  const id = Number(req.params.id);
  if (id && !isNaN(id)) {
    const sub = getActiveSubscription(id);
    if (sub) setSubscriptionStatus(sub.id, 'lapsed');
  }
  res.redirect('/admin/users');
});

export default router;