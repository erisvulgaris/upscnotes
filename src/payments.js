import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createPayment, getPaymentByOrder, capturePayment,
  upsertLifetimeSubscription, getActiveSubscription,
} from './model.js';
import { getPricing, validateCoupon, recordCouponUse } from './pricing.js';

const CURRENCY = 'INR';

// ---------------------------------------------------------------------------
// Pricing now lives in src/pricing.js and is edited from /admin/pricing.
// Previously PRICE_PAISE, COUPON_PRICE_PAISE and COUPON_CODE were hard-coded
// here *and* hard-coded again in the templates, so the admin could not change
// a price and the page could disagree with the amount actually charged.

export function currentPricing() {
  return getPricing();
}

/** Throws with a visitor-safe message if the code is not usable. */
export function resolveAmount(couponCode) {
  const p = getPricing();
  const coupon = validateCoupon(couponCode, p.amount);
  return {
    amount: coupon.amount,
    base: p.amount,
    discount: coupon.discount,
    coupon: coupon.code,
    plan: p.mode,
    perYear: p.yearly,
    durationMonths: p.terms.durationMonths,
  };
}

/** Backwards-compatible helper used by older callers. */
export function priceFor(code) {
  try {
    return resolveAmount(code).amount;
  } catch {
    return getPricing().amount;
  }
}

// Every amount the product charges comes from getPricing(), which is editable in
// the admin. These remain only so nothing downstream breaks; the old
// COUPON_PRICE_PAISE/COUPON_CODE pair advertised a Rs 299 price that is no longer
// sold and was never validated against the coupons table.
export const PRICE_PAISE = 99900;
export function couponApplies(code) {
  try {
    return !!validateCoupon(code, getPricing().amount).code;
  } catch {
    return false;
  }
}

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
export const paymentsEnabled = !!(KEY_ID && KEY_SECRET);

function hmac(data, secret) {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function payoutsFor() {
  const p = getPricing();
  return {
    price_paise: p.amount,
    currency: CURRENCY,
    coupon_price_paise: null,
    coupon_code: null,
    mode: p.mode,
    per_year: p.yearly,
  };
}

// Create a Razorpay order (or a mock one when keys are missing so the whole
// flow can be tested locally). Persists a payment row at status 'created'.
export async function createOrder(userId, couponCode = '') {
  // Throws if the code is invalid, so the page cannot show one amount and the
  // gateway charge another.
  const r = resolveAmount(couponCode);
  const receipt = `rcpt_${Date.now()}_${userId}`;
  let orderId;

  if (paymentsEnabled) {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64'),
      },
      body: JSON.stringify({ amount: r.amount, currency: CURRENCY, receipt, payment_capture: 1 }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error('Razorpay order failed: ' + text.slice(0, 400));
    }
    const data = await res.json();
    orderId = data.id;
  } else {
    orderId = 'mock_' + randomBytes(12).toString('hex');
  }

  createPayment({
    razorpay_order_id: orderId,
    user_id: userId,
    amount_paise: r.amount,
    plan: r.plan,
    coupon_code: r.coupon || null,
  });

  return {
    order_id: orderId,
    key_id: KEY_ID,
    amount: r.amount,
    currency: CURRENCY,
    mock: !paymentsEnabled,
    coupon_applied: r.coupon || null,
    discount: r.discount,
    plan: r.plan,
    per_year: r.perYear,
    duration_months: r.durationMonths,
  };
}

// Verify the client-side payment signature Razorpay returns to the browser.
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!paymentsEnabled) return true; // mock mode — no real signature
  const expected = hmac(`${orderId}|${paymentId}`, KEY_SECRET);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature || '', 'hex');

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function addMonths(date, months) {
  if (!months) return null;
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function activateFromPayment({ orderId, paymentId, signature }) {
  verifyPaymentSignature({ orderId, paymentId, signature });

  const payment = getPaymentByOrder(orderId);
  if (!payment) throw new Error('Unknown order');
  if (payment.status === 'captured') {
    return { user_id: payment.user_id };
  }

  capturePayment(payment.id, paymentId);

  // The plan the order was created with, not whatever pricing is now: an order
  // placed before a price change must still grant what was paid for.
  const plan = payment.plan || 'lifetime';
  const months = plan === 'yearly' ? 12 : 0;

  upsertLifetimeSubscription({
    userId: payment.user_id,
    plan,
    pricePaise: payment.amount_paise,
    expiresAt: addMonths(new Date(), months),
  });

  if (payment.coupon_code) recordCouponUse(payment.coupon_code);
  return { user_id: payment.user_id };
}

export function activateFromWebhook({ orderId, paymentId }) {
  const payment = getPaymentByOrder(orderId);
  if (!payment) return null;
  if (payment.status === 'captured') return null;

  capturePayment(payment.id, paymentId);

  const plan = payment.plan || 'lifetime';
  const months = plan === 'yearly' ? 12 : 0;

  upsertLifetimeSubscription({
    userId: payment.user_id,
    plan,
    pricePaise: payment.amount_paise,
    expiresAt: addMonths(new Date(), months),
  });

  if (payment.coupon_code) recordCouponUse(payment.coupon_code);
  return payment.user_id;
}

export function verifyWebhookSignature(raw, signature) {
  if (!paymentsEnabled) return true;
  if (!signature) return false;
  const expected = hmac(raw.toString('utf8'), KEY_SECRET);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}