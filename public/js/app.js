/* =====================================================================
   UPSCbooks — shared frontend behaviour
   Progressive enhancement only: every page works with JS disabled.
   ===================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  var csrfMeta = document.querySelector('meta[name="csrf"]');
  var csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function store(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* private mode */ }
  }
  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  /* ---------------------------------------------------------- theme */
  var THEME_KEY = 'upscbooks-theme';
  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    var btn = $('#theme-toggle');
    if (!btn) return;
    var dark = theme === 'dark';
    var sun = $('.ico-sun', btn);
    var moon = $('.ico-moon', btn);
    if (sun) sun.hidden = dark;
    if (moon) moon.hidden = !dark;
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#12141C' : '#1E2A52');
  }
  applyTheme(root.getAttribute('data-theme') || 'light');

  var themeBtn = $('#theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      store(THEME_KEY, next);
    });
  }
  // Follow the OS only while the reader hasn't made an explicit choice.
  if (window.matchMedia) {
    var mq = matchMedia('(prefers-color-scheme: dark)');
    var onScheme = function (e) {
      if (read(THEME_KEY)) return;
      applyTheme(e.matches ? 'dark' : 'light');
    };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
  }

  /* ------------------------------------------------- mobile drawer */
  var drawer = $('#mobile-drawer');
  var menuBtn = $('#mobile-menu-btn');
  if (drawer && menuBtn) {
    var lastFocus = null;

    function openDrawer() {
      lastFocus = document.activeElement;
      drawer.classList.add('open');
      menuBtn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      var first = $('.drawer-nav a, .drawer-head button', drawer);
      if (first) first.focus();
    }
    function closeDrawer() {
      drawer.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function isOpen() { return drawer.classList.contains('open'); }

    menuBtn.addEventListener('click', function () { isOpen() ? closeDrawer() : openDrawer(); });
    $$('[data-drawer-close]', drawer).forEach(function (el) {
      el.addEventListener('click', closeDrawer);
    });
    // Following a link inside the drawer should not leave it open behind.
    $$('a', drawer).forEach(function (a) {
      a.addEventListener('click', closeDrawer);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) closeDrawer();
      if (e.key !== 'Tab' || !isOpen()) return;
      // Keep Tab inside the drawer while it is modal.
      var focusables = $$('a[href], button:not([disabled]), input, select, textarea', drawer)
        .filter(function (el) { return el.offsetParent !== null; });
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    // If the viewport grows past the drawer breakpoint, don't strand the lock.
    if (window.matchMedia) {
      var wide = matchMedia('(min-width: 900px)');
      var onWide = function (e) { if (e.matches && isOpen()) closeDrawer(); };
      if (wide.addEventListener) wide.addEventListener('change', onWide);
      else if (wide.addListener) wide.addListener(onWide);
    }
  }

  /* ------------------------------------------------- scroll reveal */
  function initReveal() {
    var els = $$('.reveal');
    if (!els.length) return;
    if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach(function (el) { el.classList.add('revealed'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('revealed');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
    els.forEach(function (el) { io.observe(el); });
  }
  initReveal();

  /* ------------------------------------------------ back to top */
  var fab = $('#to-top-fab');
  if (fab) {
    var syncFab = function () {
      fab.classList.toggle('hide', window.scrollY < 600);
    };
    window.addEventListener('scroll', syncFab, { passive: true });
    syncFab();
    fab.addEventListener('click', function () {
      var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
    var footerTop = $('#back-to-top');
    if (footerTop) {
      footerTop.addEventListener('click', function (e) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      });
    }
  }

  /* --------------------------------------------- password revealers */
  $$('.pw-toggle').forEach(function (btn) {
    var wrap = btn.closest('.input-with-toggle');
    var input = wrap && wrap.querySelector('input');
    if (!input) return;
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      input.focus();
    });
  });

  /* --------------------------------------------- password strength */
  var pwMeter = $('[data-pw-meter]');
  if (pwMeter) {
    var pwInput = document.getElementById(pwMeter.getAttribute('data-pw-meter'));
    if (pwInput) {
      pwInput.addEventListener('input', function () {
        var v = pwInput.value;
        var score = 0;
        if (v.length >= 8) score++;
        if (v.length >= 12) score++;
        if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
        if (/\d/.test(v) && /[^\w\s]/.test(v)) score++;
        pwMeter.setAttribute('data-level', v ? String(score) : '0');
        var label = $('#pw-hint');
        if (label) {
          label.textContent = !v ? 'At least 8 characters.'
            : score <= 1 ? 'Weak — mix in numbers or symbols.'
            : score === 2 ? 'Fair.'
            : score === 3 ? 'Good.' : 'Strong.';
        }
      });
    }
  }

  /* ---------------------------------------------------------- API */
  function apiPost(url, data) {
    var headers = { 'content-type': 'application/json' };
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    return fetch(url, {
      method: 'POST',
      headers: headers,
      credentials: 'same-origin',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /* ------------------------------------------------------- coupon */
  var COUPON = { code: 'UPSC299', retail: 999, coupon: 299, key: 'upscbooks-coupon' };
  var applied = null;
  var widgets = $$('[data-coupon-widget]');

  function animateNumber(el, from, to) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = String(to); return; }
    var dur = 600, start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(from + (to - from) * eased));
      if (p < 1) { requestAnimationFrame(step); return; }
      el.textContent = String(to);
      var card = el.closest('.pricing-card');
      if (card) {
        card.classList.add('price-pop');
        setTimeout(function () { card.classList.remove('price-pop'); }, 600);
      }
    }
    requestAnimationFrame(step);
  }

  function payLabel() {
    return 'Pay ₹' + (applied ? COUPON.coupon : COUPON.retail) + ' and unlock now';
  }

  function refreshPrice(animate) {
    $$('[data-price]').forEach(function (el) {
      var to = applied ? COUPON.coupon : COUPON.retail;
      var from = parseInt(el.textContent, 10) || COUPON.retail;
      if (animate && from !== to) animateNumber(el, from, to);
      else el.textContent = String(to);
    });
    $$('[data-pay-label-text]').forEach(function (el) { el.textContent = payLabel(); });
    var old = $('[data-price-was]');
    if (old) old.textContent = '₹' + (applied ? '1,199' : '1,199');
    var strike = $('[data-price-strike]');
    if (strike) strike.hidden = !!applied;
  }

  function setCoupon(code) {
    applied = code && String(code).trim().toUpperCase() === COUPON.code ? String(code).trim().toUpperCase() : null;
    store(COUPON.key, applied);
  }

  widgets.forEach(function (w) {
    var input = w.querySelector('[data-coupon-input]');
    var btn = w.querySelector('[data-coupon-apply]');
    var msg = w.querySelector('[data-coupon-msg]');
    if (!input || !btn) return;

    function say(kind, text) {
      if (!msg) return;
      msg.className = 'coupon-msg' + (kind ? ' ' + kind : '');
      msg.textContent = text;
      msg.hidden = false;
    }
    function apply() {
      var code = (input.value || '').trim().toUpperCase();
      if (!code) { say('', 'Enter a coupon code first.'); return; }
      if (code === COUPON.code) {
        setCoupon(code);
        refreshPrice(true);
        say('ok', 'Applied — you pay ₹' + COUPON.coupon + '.');
      } else {
        say('err', 'That code is not valid.');
      }
    }

    btn.addEventListener('click', apply);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); apply(); }
    });
    if (applied) input.value = applied;
  });

  (function restoreCoupon() {
    var saved = read(COUPON.key);
    if (saved && String(saved).trim().toUpperCase() === COUPON.code) {
      setCoupon(saved);
      refreshPrice(false);
      widgets.forEach(function (w) {
        var input = w.querySelector('[data-coupon-input]');
        if (input) input.value = saved;
      });
    }
  })();
  refreshPrice(false);

  /* ---------------------------------------------------- checkout */
  var payBtn = $('#rzp-checkout');
  if (payBtn) {
    var msgEl = $('#checkout-msg');
    var busy = false;

    function say(kind, text) {
      if (!msgEl) return;
      msgEl.className = 'alert alert-' + kind;
      msgEl.textContent = text;
      msgEl.hidden = false;
    }
    function setLabel(text) {
      $$('[data-pay-label-text]').forEach(function (el) { el.textContent = text; });
      if (!$('[data-pay-label-text]')) payBtn.textContent = text;
    }

    async function finish(orderId, paymentId, signature) {
      var v = await apiPost('/api/payments/verify', {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      });
      var data = await v.json();
      if (!v.ok) throw new Error(data.error || 'Verification failed.');
      window.location.href = '/dashboard?paid=1';
    }

    async function onPay() {
      if (busy) return;
      busy = true;
      if (msgEl) msgEl.hidden = true;
      payBtn.disabled = true;
      setLabel('Creating order…');

      var order;
      try {
        var res = await apiPost('/api/checkout', { coupon: applied || null });
        order = await res.json();
        if (!res.ok) throw new Error(order.error || 'Could not create order.');
      } catch (e) {
        busy = false;
        payBtn.disabled = false;
        setLabel(payLabel());
        say('error', e.message || 'Something went wrong. Please try again.');
        return;
      }

      if (order.mock) {
        // No Razorpay keys configured — this is a local test payment.
        busy = false;
        payBtn.disabled = false;
        setLabel('Complete test payment');
        say('info', 'Payment keys are not configured, so this is a test purchase. Press the button again to complete it.');
        payBtn.dataset.mockOrder = order.order_id;
        payBtn.onclick = async function () {
          payBtn.disabled = true;
          setLabel('Confirming…');
          try {
            await finish(order.order_id, 'mock_' + Date.now(), 'mock-signature');
          } catch (e2) {
            payBtn.disabled = false;
            setLabel('Complete test payment');
            say('error', e2.message || 'Verification failed. Please retry.');
          }
        };
        return;
      }

      function loadRzp(cb) {
        if (window.Razorpay) return cb();
        var s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.async = true;
        s.onload = cb;
        s.onerror = function () {
          busy = false;
          payBtn.disabled = false;
          setLabel(payLabel());
          say('error', 'The payment gateway could not load. Check your connection and retry.');
        };
        document.body.appendChild(s);
      }

      loadRzp(function () {
        var rzp = new window.Razorpay({
          key: order.key_id,
          amount: order.amount,
          currency: order.currency,
          name: 'UPSCbooks',
          description: 'Lifetime access — the whole library',
          order_id: order.order_id,
          theme: { color: '#1E2A52' },
          handler: async function (resp) {
            try {
              await finish(resp.razorpay_order_id, resp.razorpay_payment_id, resp.razorpay_signature);
            } catch (e) {
              busy = false;
              payBtn.disabled = false;
              setLabel(payLabel());
              say('error', 'Payment went through but we could not confirm it. Email support@upscbooks.shop and we will fix it.');
            }
          },
        });
        rzp.on('payment.failed', function () {
          busy = false;
          payBtn.disabled = false;
          setLabel(payLabel());
          say('error', 'That payment did not go through. You can try again.');
        });
        rzp.open();
      });
    }

    payBtn.addEventListener('click', onPay);
    payBtn.dataset.mockOrder = '';
  }

  /* --------------------------------------------- filter chip groups */
  // Any page that renders .chip-filter chips can filter matching
  // [data-filter-group] containers — keeps the behaviour in one place.
  $$('[data-filter-group]').forEach(function (group) {
    var chips = $$('.chip-filter', group);
    var targets = $$('[data-filter-target]').map(function (el) { return [el, el.getAttribute('data-filter-target')]; });
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var want = chip.getAttribute('data-filter') || '';
        chips.forEach(function (c) { c.classList.toggle('is-active', c === chip); });
        targets.forEach(function (pair) {
          pair[0].hidden = !(want === '' || want === 'all' || pair[1] === want);
        });
      });
    });
  });
})();