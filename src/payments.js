import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createPayment, getPaymentByOrder, capturePayment,
  upsertLifetimeSubscription, getActiveSubscription,
} from './model.js';

export const PRICE_PAISE = 99900;          // ₹999 list price
export const COUPON_PRICE_PAISE = 29900;   // ₹299 with coupon
export const COUPON_CODE = 'UPSC299';
const CURRENCY = 'INR';

// A coupon code is valid when it matches (case-insensitive, trimmed).
export function couponApplies(code) {
  return String(code || '').trim().toUpperCase() === COUPON_CODE;
}

// Resolve the payable amount for a given (possibly empty) coupon code.
export function priceFor(code) {
  return couponApplies(code) ? COUPON_PRICE_PAISE : PRICE_PAISE;
}

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
export const paymentsEnabled = !!(KEY_ID && KEY_SECRET);

function hmac(data, secret) {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function payoutsFor(userId) {
  return { price_paise: PRICE_PAISE, currency: CURRENCY, coupon_price_paise: COUPON_PRICE_PAISE, coupon_code: COUPON_CODE };
}

// Create a Razorpay order (or a mock one when keys are missing so the whole
// flow can be tested locally). Persists a payment row at status 'created'.
export async function createOrder(userId, couponCode = '') {
  const amount = priceFor(couponCode);
  const coupon_applied = couponApplies(couponCode);
  const receipt = `rcpt_${Date.now()}_${userId}`;
  let orderId;

  if (paymentsEnabled) {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64'),
      },
      body: JSON.stringify({ amount, currency: CURRENCY, receipt, payment_capture: 1 }),
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

  createPayment({ razorpay_order_id: orderId, user_id: userId, amount_paise: amount });
  return { order_id: orderId, key_id: KEY_ID, amount, currency: CURRENCY, mock: !paymentsEnabled, coupon_applied };
}

// Verify the client-side payment signature Razorpay returns to the browser.
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!paymentsEnabled) return true; // mock mode — no real signature
  const expected = hmac(`${orderId}|${paymentId}`, KEY_SECRET);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature || '', 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Verify an inbound webhook signature (over the raw request body).
export function verifyWebhookSignature(rawBody, headerSig) {
  if (!paymentsEnabled) return true; // mock mode — accept and let route logic run
  const digest = hmac(rawBody, KEY_SECRET);
  const a = Buffer.from(digest, 'hex');
  const b = Buffer.from(headerSig || '', 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Mark a payment captured and grant the lifetime subscription.
export function activateFromPayment({ orderId, paymentId, signature }) {
  const pay = getPaymentByOrder(orderId);
  if (!pay) throw new Error('Unknown order ' + orderId);
  if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
    throw new Error('Invalid payment signature');
  }
  const captured = capturePayment({
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId || null,
    signature: signature || null,
    raw: JSON.stringify({ orderId, paymentId }),
  });
  const sub = upsertLifetimeSubscription(pay.user_id, {
    source: 'razorpay',
    price_paise: pay.amount_paise,
    payment_id: captured.id,
  });
  return { user_id: pay.user_id, sub };
}

// Webhook path: already-active users are ignored, otherwise a captured payment
// grants access exactly once.
export function activateFromWebhook({ orderId, paymentId }) {
  const pay = getPaymentByOrder(orderId);
  if (!pay) return false;
  if (getActiveSubscription(pay.user_id)) return true; // already active
  if (pay.status === 'captured') return true;          // already processed
  const captured = capturePayment({
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId || null,
    signature: null,
    raw: JSON.stringify({ via: 'webhook', orderId, paymentId }),
  });
  upsertLifetimeSubscription(pay.user_id, {
    source: 'razorpay',
    price_paise: pay.amount_paise,
    payment_id: captured.id,
  });
  return true;
}
