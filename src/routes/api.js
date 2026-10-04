import { Router } from 'express';
import { requireAuth } from '../middleware.js';
import { getBookBySlug, searchChapters } from '../model.js';
import {
  createOrder, activateFromPayment, activateFromWebhook, verifyWebhookSignature,
} from '../payments.js';
import { getPricing, validateCoupon } from '../pricing.js';

const router = Router();

router.get('/health', (req, res) => res.json({ ok: true }));

// What a discount code is worth, at the current price. The client asks rather
// than deciding, so any code created in the admin works on the checkout page
// and the button can never quote an amount the gateway will not charge.
// Public: a visitor needs to know their code is worth something before they
// have an account, and the answer reveals nothing they cannot already see.
router.get('/coupon', (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ ok: false, error: 'Enter a coupon code.' });
  try {
    const p = getPricing();
    const r = validateCoupon(code, p.amount);
    if (!r.code) return res.status(400).json({ ok: false, error: 'Enter a coupon code.' });
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true, code: r.code, amount: r.amount, discount: r.discount,
      base: p.amount, mode: p.mode,
    });
  } catch (e) {
    // The message is written for the visitor and names no internal state.
    res.status(400).json({ ok: false, error: e.message || 'That code is not valid.' });
  }
});

// Full-text search across a book's chapters (titles + content).
router.get('/search/:slug', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  const book = getBookBySlug(req.params.slug);
  if (!book) return res.status(404).json({ ok: false, error: 'unknown book' });
  if (q.length < 2) return res.json({ ok: true, query: q, results: [] });
  const results = searchChapters(book.id, q);
  res.json({ ok: true, query: q, results });
});

// Create a payment order for the current user (guards against re-purchase).
router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const coupon = (req.body && req.body.coupon) || '';
    const order = await createOrder(req.session.userId, coupon);
    res.json(order);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Verify a payment completed in the browser (Razorpay Checkout success path).
router.post('/payments/verify', requireAuth, (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id) return res.status(400).json({ ok: false, error: 'missing order id' });
  try {
    const result = activateFromPayment({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    res.json({ ok: true, user_id: result.user_id });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Razorpay webhook — activates on `payment.captured`.
router.post('/payments/webhook', (req, res) => {
  const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
  const sig = req.headers['x-razorpay-signature'] || '';
  if (!verifyWebhookSignature(raw, sig)) {
    return res.status(400).json({ ok: false, error: 'invalid signature' });
  }
  const event = req.body || {};
  const payment = event.payload?.payment?.entity;
  try {
    if (event.event === 'payment.captured' && payment) {
      activateFromWebhook({ orderId: payment.order_id, paymentId: payment.id });
    }
    res.json({ ok: true, received: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

export default router;
