import { Router } from 'express';
import { requireAuth } from '../middleware.js';
import {
  getBookBySlug, searchChapters, getProgress, setProgress, setReadingPosition,
  listBookmarks, createBookmark, deleteBookmark,
  listNotes, createNote, updateNote, deleteNote,
} from '../model.js';
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

// ---------------------------------------------------------------- progress
//
// Read position is written on a timer while listening or scrolling, so these are
// deliberately cheap and never touch the chapter number: the reader page owns
// that, and a late heartbeat must not drag the reader back to an old chapter.

router.get('/progress/:slug', requireAuth, (req, res) => {
  const book = getBookBySlug(req.params.slug);
  if (!book) return res.status(404).json({ ok: false, error: 'unknown book' });
  const p = getProgress(req.session.userId, book.id);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, progress: p || null });
});

router.post('/progress/:slug', requireAuth, (req, res) => {
  const book = getBookBySlug(req.params.slug);
  if (!book) return res.status(404).json({ ok: false, error: 'unknown book' });
  const b = req.body || {};
  const chapter = Number(b.chapter);
  if (!Number.isFinite(chapter) || chapter < 1) {
    return res.status(400).json({ ok: false, error: 'chapter is required' });
  }
  // A heartbeat still in flight from a page the reader has already left must not
  // drag them backwards. Moving forward is legitimate and is adopted here; only an
  // incoming chapter *behind* the stored one is discarded.
  const current = getProgress(req.session.userId, book.id);
  if (current && Number(current.chapter_number) > chapter) {
    return res.json({ ok: true, ignored: true });
  }
  if (!current || Number(current.chapter_number) !== chapter) {
    setProgress(req.session.userId, book.id, chapter);
  }
  setReadingPosition(req.session.userId, book.id, {
    audioMs: b.audioMs,
    scrollPct: b.scrollPct,
    completed: !!b.completed,
  });
  res.json({ ok: true });
});

// --------------------------------------------------------------- bookmarks

router.get('/bookmarks/:slug', requireAuth, (req, res) => {
  const book = getBookBySlug(req.params.slug);
  if (!book) return res.status(404).json({ ok: false, error: 'unknown book' });
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, bookmarks: listBookmarks(req.session.userId, book.id) });
});

router.post('/bookmarks/:slug', requireAuth, (req, res) => {
  const book = getBookBySlug(req.params.slug);
  if (!book) return res.status(404).json({ ok: false, error: 'unknown book' });
  try {
    const b = req.body || {};
    const made = createBookmark(req.session.userId, book.id, {
      chapterNumber: b.chapter,
      audioMs: b.audioMs,
      scrollPct: b.scrollPct,
      label: b.label,
    });
    res.json({ ok: true, bookmark: made });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Could not save that bookmark.' });
  }
});

router.delete('/bookmarks/:slug/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  const removed = deleteBookmark(req.session.userId, id);
  if (!removed) return res.status(404).json({ ok: false, error: 'no such bookmark' });
  res.json({ ok: true });
});

// ------------------------------------------------------------------- notes

router.get('/notes/:slug', requireAuth, (req, res) => {
  const book = getBookBySlug(req.params.slug);
  if (!book) return res.status(404).json({ ok: false, error: 'unknown book' });
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, notes: listNotes(req.session.userId, book.id) });
});

router.post('/notes/:slug', requireAuth, (req, res) => {
  const book = getBookBySlug(req.params.slug);
  if (!book) return res.status(404).json({ ok: false, error: 'unknown book' });
  try {
    const b = req.body || {};
    const made = createNote(req.session.userId, book.id, {
      chapterNumber: b.chapter,
      body: b.body,
      audioMs: b.audioMs,
      scrollPct: b.scrollPct,
    });
    res.status(201).json({ ok: true, note: made });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Could not save that note.' });
  }
});

router.put('/notes/:slug/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  try {
    if (!updateNote(req.session.userId, id, (req.body || {}).body)) {
      return res.status(404).json({ ok: false, error: 'no such note' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Could not update that note.' });
  }
});

router.delete('/notes/:slug/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  if (!deleteNote(req.session.userId, id)) {
    return res.status(404).json({ ok: false, error: 'no such note' });
  }
  res.json({ ok: true });
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
