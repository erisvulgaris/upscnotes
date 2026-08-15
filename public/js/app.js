/* UPSCbooks shared frontend logic */
(function () {
  var csrf = document.querySelector('meta[name="csrf"]');
  var csrfToken = csrf ? csrf.getAttribute('content') : '';

  // Scroll reveal — fades + lifts elements in once, staggered via --d.
  function initReveal() {
    var els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('revealed'); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { observer.observe(el); });
  }

  initReveal();

  // Theme toggle support (theme switched via a small control where present).
  var toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var dark = document.documentElement.classList.toggle('dark');
      try { localStorage.setItem('upscbooks-theme', dark ? 'dark' : 'light'); } catch (e) {}
    });
  }

  function apiPost(url, data) {
    var headers = { 'content-type': 'application/json' };
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    return fetch(url, { method: 'POST', headers: headers, body: data ? JSON.stringify(data) : undefined });
  }

  // ---- Coupon widget — animate the price down to the coupon price ----
  var COUPON_CODE = 'UPSC299';
  var PRICE_RETAIL = 999;
  var PRICE_COUPON = 299;
  var COUPON_STORE = 'upscbooks-coupon';

  function savedCoupon() {
    try { return localStorage.getItem(COUPON_STORE) || ''; } catch (e) { return ''; }
  }
  function persistCoupon(code) {
    try {
      if (code) localStorage.setItem(COUPON_STORE, code);
      else localStorage.removeItem(COUPON_STORE);
    } catch (e) {}
  }
  // Animate a number element from `from` to `to` (counts down/up with ease + pop).
  function animateValue(el, from, to) {
    var dur = 650, start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = Math.round(from + (to - from) * eased);
      el.textContent = String(val);
      if (p < 1) { requestAnimationFrame(step); }
      else {
        el.textContent = String(to);
        var card = el.closest('.pricing-card');
        if (card) {
          card.classList.add('price-pop');
          setTimeout(function () { card.classList.remove('price-pop'); }, 600);
        }
      }
    }
    requestAnimationFrame(step);
  }

  // One shared "applied coupon" state; applied via any [data-coupon-widget].
  var appliedCoupon = null;
  var widgets = document.querySelectorAll('[data-coupon-widget]');
  function refreshPrice(animate) {
    document.querySelectorAll('[data-price]').forEach(function (priceEl) {
      var from = parseInt(priceEl.textContent, 10) || PRICE_RETAIL;
      var to = appliedCoupon ? PRICE_COUPON : PRICE_RETAIL;
      if (animate && from !== to) animateValue(priceEl, from, to);
      else priceEl.textContent = String(to);
    });
    var payLabel = document.querySelector('[data-pay-label-text]');
    if (payLabel) payLabel.textContent = appliedCoupon ? 'Pay ₹' + PRICE_COUPON + ' and unlock now' : 'Pay ₹' + PRICE_RETAIL + ' and unlock now';
  }
  function setCouponState(code) {
    appliedCoupon = code && String(code).trim().toUpperCase() === COUPON_CODE ? code : null;
    if (appliedCoupon) persistCoupon(appliedCoupon); else persistCoupon(null);
  }
  widgets.forEach(function (w) {
    var input = w.querySelector('[data-coupon-input]');
    var applyBtn = w.querySelector('[data-coupon-apply]');
    var msg = w.querySelector('[data-coupon-msg]');
    function setMsg(kind, text) {
      if (!msg) return;
      msg.className = 'coupon-msg' + (kind ? ' ' + kind : '');
      msg.textContent = text;
      msg.hidden = false;
    }
    applyBtn.addEventListener('click', function () {
      var code = (input.value || '').trim().toUpperCase();
      if (code === COUPON_CODE) {
        setCouponState(code);
        refreshPrice(true);
        setMsg('ok', 'Coupon applied — you pay ₹' + PRICE_COUPON + '!');
      } else if (code) {
        setMsg('err', 'Invalid coupon code. Try ' + COUPON_CODE + '.');
      } else {
        setMsg('', 'Enter a coupon code first.');
      }
    });
    // Mobile keyboard "Go/Enter" submits the coupon like the Apply button.
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyBtn.click();
      }
    });
    // Keep the input in sync when another widget already applied the coupon.
    if (appliedCoupon) input.value = appliedCoupon;
  });
  // Restore a previously applied coupon (auto-apply on next visits).
  (function () {
    var saved = savedCoupon();
    if (saved && String(saved).trim().toUpperCase() === COUPON_CODE) {
      setCouponState(saved);
      refreshPrice(false);
      widgets.forEach(function (w) {
        var input = w.querySelector('[data-coupon-input]');
        if (input) input.value = saved;
      });
    }
  })();

  // ---- Razorpay checkout (with a local mock path for keyless dev) ----
  var btn = document.getElementById('rzp-checkout');
  if (btn) {
    var btnLabel = document.querySelector('[data-pay-label-text]') || btn;
    function setPayLabel(text, withArrow) {
      var label = text + (withArrow ? ' →' : '');
      if (btnLabel === btn) btn.textContent = label;
      else btnLabel.textContent = label;
    }
    function payNowLabel() {
      return appliedCoupon ? 'Pay ₹' + PRICE_COUPON + ' and unlock now' : 'Pay ₹' + PRICE_RETAIL + ' and unlock now';
    }
    var msgEl = document.getElementById('checkout-msg');
    function showMsg(kind, text) {
      if (!msgEl) return;
      msgEl.className = 'alert alert-' + kind;
      msgEl.textContent = text;
      msgEl.hidden = false;
    }
    function clearMsg() { if (msgEl) { msgEl.hidden = true; } }

    btn.addEventListener('click', async function () {
      clearMsg();
      btn.disabled = true;
      setPayLabel('Creating order…', false);
      var order;
      try {
        var res = await apiPost('/api/checkout', { coupon: appliedCoupon || null });
        order = await res.json();
        if (!res.ok) throw new Error(order.error || 'Could not create order');
      } catch (e) {
        btn.disabled = false;
        setPayLabel(payNowLabel(), true);
        showMsg('error', e.message || 'Something went wrong. Please try again.');
        return;
      }

      if (order.mock) {
        // No Razorpay keys configured — simulate a successful payment.
        setPayLabel('Complete test payment', false);
        btn.onclick = async function () {
          try {
            var v = await apiPost('/api/payments/verify', {
              razorpay_order_id: order.order_id,
              razorpay_payment_id: 'mock_' + Date.now(),
              razorpay_signature: 'mock-signature',
            });
            var vj = await v.json();
            if (!v.ok) throw new Error(vj.error || 'Verification failed');
            window.location.href = '/dashboard?paid=1';
          } catch (e2) {
            showMsg('error', e2.message || 'Verification failed. Please retry.');
          }
        };
        showMsg('info', 'Razorpay keys are not set — this is a test payment. Click the button again to complete it.');
        btn.disabled = false;
        return;
      }

      // Real Razorpay checkout.
      function loadRzp(cb) {
        if (window.Razorpay) return cb();
        var s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = cb;
        s.onerror = function () { showMsg('error', 'Payment gateway failed to load. Please retry.'); btn.disabled = false; setPayLabel(payNowLabel(), true); };
        document.body.appendChild(s);
      }

      loadRzp(function () {
        var rzp = new Razorpay({
          key: order.key_id,
          amount: order.amount,
          currency: order.currency,
          name: 'UPSCbooks',
          description: 'Lifetime access — all books',
          order_id: order.order_id,
          handler: async function (resp) {
            try {
              var v = await apiPost('/api/payments/verify', {
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
              });
              var vj = await v.json();
              if (!v.ok) throw new Error(vj.error || 'Verification failed');
              window.location.href = '/dashboard?paid=1';
            } catch (e) {
              showMsg('error', e.message || 'Payment received but verification failed. Contact support.');
            }
          },
          theme: { color: '#1E2A52' },
        });
        rzp.on('payment.failed', function () {
          showMsg('error', 'Payment failed. You can try again.');
          btn.disabled = false;
          setPayLabel(payNowLabel(), true);
        });
        rzp.open();
      });
    });
  }
})();
