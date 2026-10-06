import { Router } from 'express';
import multer from 'multer';
import { requireAdmin } from '../middleware.js';
import { renderPage } from '../render.js';
import {
  listUsers, countUsers, countActiveSubs, listPayments, sumCaptured,
  listBooks, activateForUserByAdmin, setSubscriptionStatus, getActiveSubscription,
  getUserById, searchUsers, getUserSubscriptions, getUserPayments, extendSubscription,
} from '../model.js';
import {
  getPricing, setSetting, listCoupons, createCoupon,
  setCouponActive, deleteCoupon, rupees, getSetting,
} from '../pricing.js';
import { safeSlug, uploadCover, deleteCover, r2Configured } from '../cover.js';

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
  const q = String(req.query.q || '').trim();
  const users = listUsers().map((u) => ({
    ...u,
    active_sub: getActiveSubscription(u.id) || null,
  }));
  renderPage(res, 200, 'admin/users', { title: 'Admin · Members', active: 'users', users, q, csrf: res.locals.csrf });
});

router.get('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.redirect('/admin/users');
  const user = getUserById(id);
  if (!user) return res.redirect('/admin/users');
  renderPage(res, 200, 'admin/user-detail', {
    title: 'Admin · ' + (user.name || user.email), active: 'users',
    user,
    subscriptions: getUserSubscriptions(id),
    payments: getUserPayments(id),
    flash: req.session.flash || null,
  });
  delete req.session.flash;
});

router.get('/payments', (req, res) => {
  renderPage(res, 200, 'admin/payments', {
    title: 'Admin · Payments', active: 'payments', payments: listPayments(), RUPEE,
  });
});

router.get('/books', (req, res) => {
  renderPage(res, 200, 'admin/books', {
    title: 'Admin · Books',
    active: 'books',
    books: listBooks(),
    r2Configured,
    flash: req.session.flash || null,
  });
  delete req.session.flash;
});

// ------------------------------------------------------------ cover upload
//
// Covers are written straight to R2 at covers/<slug>.jpg, which is the same
// path /covers/<slug>.jpg serves, so an upload shows up across the site with
// no further wiring. Bytes are held in memory (covers are small) and validated
// on both the declared type and the actual magic number.

const MAX_COVER_BYTES = 4 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_COVER_BYTES, files: 1 },
});

// Multer reports failures through next(err), which would bypass the handler's
// try/catch and land in the generic error page. Park the error on the request
// so the upload path can report it through the same flash channel as the rest.
const captureUpload = (field) => (req, res, next) => {
  upload.single(field)(req, res, (err) => {
    if (err) req.uploadError = err;
    next();
  });
};

const ALLOWED_TYPES = new Set(['image/jpeg']);

// A declared content-type is attacker-controlled, so confirm the bytes really
// are the image type we are about to serve as. JPEG only: the whole cover
// pipeline (R2 key, /covers route, template URLs) is .jpg, so accepting PNG or
// WebP would store those bytes under a .jpg key with a mismatched content type.
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

const EXT_FOR = { 'image/jpeg': 'jpg' };

router.post('/books/:slug/cover', captureUpload('cover'), async (req, res) => {
  const slug = safeSlug(req.params.slug);
  try {
    if (req.uploadError) {
      throw new Error(
        req.uploadError.code === 'LIMIT_FILE_SIZE'
          ? 'That image is larger than 4 MB.'
          : 'That file could not be read.'
      );
    }
    if (!slug) throw new Error('Invalid book.');
    const book = getBookBySlug(slug);
    if (!book) throw new Error('No such book.');

    const file = req.file;
    if (!file) throw new Error('Choose an image file to upload.');

    const sniffed = sniffImage(file.buffer);
    if (!sniffed || !ALLOWED_TYPES.has(sniffed)) {
      throw new Error('Cover must be a JPEG image. Re-save the file as JPEG and try again.');
    }

    await uploadCover(slug, file.buffer, sniffed);
    updateBook(slug, { cover: EXT_FOR[sniffed] });

    flash(req, 'success', 'Cover updated for ' + book.title + '.');
  } catch (e) {
    flash(req, 'error', e.message || 'Upload failed.');
  }
  res.redirect('/admin/books');
});

router.post('/books/:slug/cover/remove', async (req, res) => {
  const slug = safeSlug(req.params.slug);
  try {
    if (!slug) throw new Error('Invalid book.');
    const book = getBookBySlug(slug);
    if (!book) throw new Error('No such book.');
    await deleteCover(slug);
    // books.cover is NOT NULL; the schema treats '' as "no cover".
    updateBook(slug, { cover: '' });
    flash(req, 'success', 'Cover removed for ' + book.title + '. It will use the generated cover art.');
  } catch (e) {
    flash(req, 'error', e.message || 'Could not remove that cover.');
  }
  res.redirect('/admin/books');
});

// Grant a member lifetime access (admin-comped).
router.post('/users/:id/grant', (req, res) => {
  const id = Number(req.params.id);
  if (id && !isNaN(id) && Number(id) !== req.session.userId) {
    activateForUserByAdmin(id, 0);
    flash(req, 'success', 'Lifetime access granted.');
  }
  res.redirect('/admin/users');
});

// Revoke a member's access (marks active subs lapsed).
router.post('/users/:id/revoke', (req, res) => {
  const id = Number(req.params.id);
  if (id && !isNaN(id)) {
    const sub = getActiveSubscription(id);
    if (sub) {
      setSubscriptionStatus(sub.id, 'lapsed');
      flash(req, 'success', 'Subscription revoked.');
    } else {
      flash(req, 'error', 'No active subscription found.');
    }
  }
  res.redirect('/admin/users');
});

// Extend a specific subscription by N days.
router.post('/users/:id/extend', (req, res) => {
  const id = Number(req.params.id);
  const subId = Number(req.body.sub_id);
  const days = Math.max(1, Math.round(Number(req.body.days) || 365));
  if (!Number.isFinite(id) || !Number.isFinite(subId)) return res.redirect('/admin/users');
  const sub = extendSubscription(subId, days);
  if (!sub) {
    flash(req, 'error', 'Subscription not found.');
    return res.redirect('/admin/users/' + id);
  }
  flash(req, 'success', 'Extended to ' + sub.expires_at + '.');
  res.redirect('/admin/users/' + id);
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
    setSetting('request_book_email', String(b.request_book_email || '').trim().slice(0, 200));
    setSetting('request_book_message', String(b.request_book_message || '').trim().slice(0, 1000));

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