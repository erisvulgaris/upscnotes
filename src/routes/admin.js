import { Router } from 'express';
import { requireAdmin } from '../middleware.js';
import { renderPage } from '../render.js';
import {
  listUsers, countUsers, countActiveSubs, listPayments, sumCaptured,
  listBooks, activateForUserByAdmin, setSubscriptionStatus, getActiveSubscription,
} from '../model.js';
import {
  getPricing, setSetting, listCoupons, createCoupon,
  setCouponActive, deleteCoupon, rupees, getSetting,
} from '../pricing.js';

const router = Router();

const RUPEE = (p) => '₹' + ((p || 0) / 100).toLocaleString('en-IN');

router.use(requireAdmin);

// Amounts arrive in rupees from a form and are stored in paise. Keeping that
// boundary in one place is what stops a float ever touching money.
const toPaise = (rs) => {
  const n = Number(String(rs ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
};
const toRupees = (p) => (Math.round(Number(p) || 0) / 100).toFixed(2);

function flash(req, kind, text) {
  req.session.flash = { kind, text };
}

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

// ---------------------------------------------------------------- pricing
//
// One place for every price the product shows. The checkout page, the locked
// page, the landing page and the order API all read getPricing(), so switching
// to yearly or adding a discount code is a change here rather than a code edit
// repeated across four files.

router.get('/pricing', (req, res) => {
  renderPage(res, 200, 'admin/pricing', {
    title: 'Pricing',
    metaDesc: 'Platform pricing and discount codes.',
    active: 'pricing',
    pricing: getPricing(),
    settings: {
      price_lifetime: toRupees(getSetting('price_lifetime')),
      price_yearly: toRupees(getSetting('price_yearly')),
      compare_price: toRupees(getSetting('compare_price')),
      pricing_note: getSetting('pricing_note') || '',
      grace_days: getSetting('grace_days') || '0',
      coupons_enabled: getSetting('coupons_enabled') === '1',
    },
    coupons: listCoupons(),
    flash: req.session.flash || null,
    rupees,
  });
  delete req.session.flash;
});

router.post('/pricing', (req, res) => {
  try {
    const b = req.body || {};
    setSetting('pricing_mode', b.pricing_mode === 'yearly' ? 'yearly' : 'lifetime');
    setSetting('price_lifetime', toPaise(b.price_lifetime));
    setSetting('price_yearly', toPaise(b.price_yearly));
    setSetting('compare_price', toPaise(b.compare_price));
    setSetting('pricing_note', String(b.pricing_note || '').slice(0, 200));
    setSetting('grace_days', Math.max(0, Math.round(Number(b.grace_days) || 0)));
    setSetting('coupons_enabled', b.coupons_enabled ? '1' : '0');

    const p = getPricing();
    flash(req, 'success', 'Saved. Visitors now see ' + p.amountLabel + ' ' + p.terms.cadence + '.');
  } catch (e) {
    flash(req, 'error', e.message || 'Could not save.');
  }
  res.redirect('/admin/pricing');
});

router.post('/coupons', (req, res) => {
  try {
    const b = req.body || {};
    createCoupon({
      code: b.code,
      kind: b.kind,
      value: b.kind === 'percent' ? Number(b.value) : toPaise(b.value),
      maxUses: b.max_uses,
      expiresAt: b.expires_at || null,
      note: b.note,
    });
    flash(req, 'success', 'Code ' + String(b.code || '').trim().toUpperCase() + ' created.');
  } catch (e) {
    flash(req, 'error', e.message || 'Could not create that code.');
  }
  res.redirect('/admin/pricing');
});

router.post('/coupons/:code/toggle', (req, res) => {
  try {
    const code = String(req.params.code).toUpperCase();
    const current = listCoupons().find((c) => c.code === code);
    if (!current) throw new Error('No such code.');
    setCouponActive(code, !current.active);
    flash(req, 'success', code + (current.active ? ' disabled.' : ' enabled.'));
  } catch (e) {
    flash(req, 'error', e.message);
  }
  res.redirect('/admin/pricing');
});

router.post('/coupons/:code/delete', (req, res) => {
  try {
    deleteCoupon(req.params.code);
    flash(req, 'success', String(req.params.code).toUpperCase() + ' deleted.');
  } catch (e) {
    flash(req, 'error', e.message);
  }
  res.redirect('/admin/pricing');
});

export default router;