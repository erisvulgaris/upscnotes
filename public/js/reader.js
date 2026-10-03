/* =====================================================================
   UPSCbooks reader
   - Chapter sheet (bottom sheet on phone, side panel on desktop)
   - Full-text search inside the book
   - Continuous reading: the next chapter is pre-fetched and appended
   - Public hook (window.UPSC_Reader) the TTS engine uses to cross a
     chapter boundary without stopping
   ===================================================================== */
(function () {
  'use strict';

  var main = document.getElementById('rd-body');
  if (!main) return;

  var CFG = window.UPSCBOOKS || {};
  var slug = main.getAttribute('data-slug') || CFG.slug;
  var cur = parseInt(main.getAttribute('data-chapter'), 10) || CFG.chapter || 1;
  var last = parseInt(main.getAttribute('data-last'), 10) || CFG.last || cur;

  var loadBox = document.getElementById('rd-load');
  var loadText = document.getElementById('rd-load-text');
  var sheet = document.getElementById('ch-sheet');
  var openBtn = document.getElementById('ch-open');

  var loadingNext = null;
  var failed = false;
  // Set by a real user scroll and cleared after every successful chapter load,
  // so a chain of chapters can never load unattended.
  var userScrolled = false;

  /* ------------------------------------------------- continuous read */

  function maxSid() {
    var m = -1;
    var nodes = document.querySelectorAll('.tts-sent');
    for (var i = 0; i < nodes.length; i++) {
      var v = parseInt(nodes[i].getAttribute('data-sid'), 10);
      if (v > m) m = v;
    }
    return m;
  }

  function hasNext() { return cur < last && !failed; }

  var continueBtn = null;

  function setLoadState(kind, text) {
    if (!loadBox) return;
    loadBox.classList.toggle('is-end', kind === 'end');
    if (loadText) loadText.textContent = text;
  }

  // One persistent button, updated in place. Recreating it per chapter
  // detached the node mid-interaction and threw away keyboard focus.
  function ensureContinueButton() {
    if (!loadBox) return;
    if (!hasNext()) {
      if (continueBtn) { continueBtn.remove(); continueBtn = null; }
      return;
    }
    if (!continueBtn) {
      continueBtn = document.createElement('button');
      continueBtn.className = 'btn btn-ghost';
      continueBtn.type = 'button';
      continueBtn.addEventListener('click', loadNext);
      loadBox.appendChild(continueBtn);
    }
    continueBtn.textContent = 'Continue to chapter ' + (cur + 1);
  }

  function loadNext() {
    if (!hasNext()) return Promise.resolve(false);
    if (loadingNext) return loadingNext;

    var n = cur + 1;
    setLoadState('loading', 'Loading chapter ' + n + '…');

    loadingNext = fetch('/read/' + encodeURIComponent(slug) + '/' + n + '/fragment?sidBase=' + (maxSid() + 1), {
      credentials: 'same-origin',
      headers: { accept: 'text/html' },
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (html) {
        if (!html.trim()) throw new Error('empty fragment');

        var kicker = document.createElement('div');
        kicker.className = 'rd-next';
        kicker.innerHTML = '<span class="rd-next-kicker">Chapter ' + n + '</span>';

        var body = document.createElement('div');
        body.className = 'rd-next-body';
        body.innerHTML = html;

        loadBox.parentNode.insertBefore(kicker, loadBox);
        loadBox.parentNode.insertBefore(body, loadBox);

        cur = n;
        markActive(n);
        updateSheetProgress();
        setLoadState(hasNext() ? 'more' : 'end',
          hasNext() ? 'Chapter ' + n + ' loaded — keep scrolling.' : 'End of book.');
        ensureContinueButton();
        // A fresh load must not immediately trigger another one.
        userScrolled = false;
        return true;
      })
      .catch(function () {
        failed = true;
        setLoadState('end', 'Could not load the next chapter automatically.');
        if (continueBtn) { continueBtn.remove(); continueBtn = null; }
        var btn = document.createElement('button');
        btn.className = 'btn btn-ghost';
        btn.type = 'button';
        btn.textContent = 'Retry chapter ' + (cur + 1);
        btn.addEventListener('click', function () {
          failed = false;
          loadNext();
        });
        loadBox.appendChild(btn);
        return false;
      })
      .then(function (ok) {
        loadingNext = null;
        return ok;
      });

    return loadingNext;
  }

  function initAutoLoad() {
    userScrolled = false;
    if (hasNext()) setLoadState('more', 'Scroll on to continue reading');
    else setLoadState('end', 'End of book');
    ensureContinueButton();

    if ('IntersectionObserver' in window && loadBox) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) loadNext(); });
      }, { rootMargin: '900px 0px' });
      io.observe(loadBox);
    }

    // Backstop for observers that never fire: a restored scroll position, or a
    // short viewport, can leave the sentinel on screen without ever crossing
    // the observer margin. Requires a real user scroll so a chain of chapters
    // cannot load unattended.
    window.addEventListener('scroll', function () { userScrolled = true; }, { passive: true });
    setTimeout(function () {
      if (!loadBox || !hasNext() || loadingNext) return;
      var r = loadBox.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) loadNext();
    }, 500);
  }

  /* ------------------------------------------------------ chapter sheet */

  function markActive(n) {
    var items = document.querySelectorAll('.ch-item');
    for (var i = 0; i < items.length; i++) {
      var match = parseInt(items[i].getAttribute('data-n'), 10) === n;
      if (match) items[i].setAttribute('aria-current', 'true');
      else items[i].removeAttribute('aria-current');
    }
  }

  function updateSheetProgress() {
    var el = document.querySelector('.ch-sheet-progress');
    if (el) el.textContent = cur + ' loaded';
  }

  function openSheet() {
    if (!sheet) return;
    sheet.classList.add('open');
    openBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    var input = document.getElementById('ch-search');
    if (input) setTimeout(function () { input.focus(); }, 120);
  }
  function closeSheet() {
    if (!sheet) return;
    sheet.classList.remove('open');
    openBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  if (sheet) {
    if (openBtn) openBtn.addEventListener('click', function () {
      sheet.classList.contains('open') ? closeSheet() : openSheet();
    });
    Array.prototype.forEach.call(sheet.querySelectorAll('[data-sheet-close]'), function (el) {
      el.addEventListener('click', closeSheet);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet();
    });
    // Following a chapter link should not leave the sheet covering the page.
    Array.prototype.forEach.call(sheet.querySelectorAll('a'), function (a) {
      a.addEventListener('click', closeSheet);
    });
  }

  /* --------------------------------------------- in-book full-text search */

  var searchInput = document.getElementById('ch-search');
  var resultsBox = document.getElementById('ch-results');
  var chapterList = document.getElementById('ch-list');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderEmpty(msg) {
    if (resultsBox) resultsBox.innerHTML = '<div class="ch-empty">' + esc(msg) + '</div>';
  }

  if (searchInput && resultsBox && chapterList) {
    var debounce = null;

    function filterTitles(q) {
      // 1 character: filter the visible chapter list locally, no round trip.
      resultsBox.innerHTML = '';
      chapterList.hidden = false;
      var hits = 0;
      Array.prototype.forEach.call(chapterList.querySelectorAll('.ch-item'), function (item) {
        var hay = (item.getAttribute('data-title') || '') + ' ' + item.getAttribute('data-n');
        var ok = hay.indexOf(q) !== -1;
        item.style.display = ok ? '' : 'none';
        if (ok) hits++;
      });
      if (!hits) renderEmpty('No chapter title matches that.');
    }

    function searchRemote(q) {
      chapterList.hidden = true;
      renderEmpty('Searching…');
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        fetch('/api/search/' + encodeURIComponent(slug) + '?q=' + encodeURIComponent(q), {
          credentials: 'same-origin',
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var results = (data && data.ok && data.results) || [];
            if (!results.length) { renderEmpty('Nothing in this book matches "' + q + '".'); return; }
            resultsBox.innerHTML = results
              .map(function (r) {
                return '<a class="ch-item" href="/read/' + encodeURIComponent(slug) + '/' + r.number + '">' +
                  '<span class="ch-item-n">CHAPTER ' + r.number + '</span>' +
                  '<span>' + esc(r.title) + '</span>' +
                  (r.snippet ? '<span class="ch-item-snip">' + esc(r.snippet) + '</span>' : '') +
                  '</a>';
              })
              .join('');
          })
          .catch(function () { renderEmpty('Search failed. Try again.'); });
      }, 260);
    }

    searchInput.addEventListener('input', function () {
      var q = (searchInput.value || '').trim().toLowerCase();
      clearTimeout(debounce);
      if (!q) {
        chapterList.hidden = false;
        resultsBox.innerHTML = '';
        Array.prototype.forEach.call(chapterList.querySelectorAll('.ch-item'), function (i) {
          i.style.display = '';
        });
        return;
      }
      if (q.length === 1) filterTitles(q);
      else searchRemote(q);
    });

    searchInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      searchInput.value = '';
      chapterList.hidden = false;
      resultsBox.innerHTML = '';
      Array.prototype.forEach.call(chapterList.querySelectorAll('.ch-item'), function (i) {
        i.style.display = '';
      });
    });
  }

  /* ------------------------------------------------------ reading progress */

  var bar = document.getElementById('rd-progress');
  if (bar) {
    var ticking = false;
    function update() {
      ticking = false;
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var pct = max > 8 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 100;
      bar.style.width = pct + '%';
      bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* ------------------------------------------------------- text size */

  var scaleBtn = document.getElementById('font-toggle');
  var SCALES = [0.9, 1, 1.15, 1.3];
  function applyScale(v) {
    document.documentElement.style.setProperty('--font-scale', String(v));
    try { localStorage.setItem('upscbooks-font-scale', String(v)); } catch (e) {}
  }
  function bumpScale() {
    var cur2 = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-scale')) || 1;
    var i = SCALES.indexOf(cur2);
    applyScale(SCALES[(i + 1) % SCALES.length]);
  }
  if (scaleBtn) scaleBtn.addEventListener('click', bumpScale);

  /* ----------------------------------------------- figure lightbox */

  var lb = document.getElementById('rd-lb');
  if (lb) {
    var lbImg = document.getElementById('rd-lb-img');
    var lbCap = document.getElementById('rd-lb-cap');
    var lbClose = document.getElementById('rd-lb-close');

    function openLb(src, cap) {
      lbImg.src = src;
      lbImg.alt = cap || 'Figure';
      lbCap.textContent = cap || '';
      lb.hidden = false;
      lbClose.focus();
    }
    function closeLb() { lb.hidden = true; lbImg.src = ''; }

    document.addEventListener('click', function (e) {
      var fig = e.target.closest ? e.target.closest('.rd-figure img') : null;
      if (fig) { openLb(fig.currentSrc || fig.src, fig.alt || ''); return; }
      if (e.target === lb || e.target.closest('#rd-lb-close')) closeLb();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !lb.hidden) closeLb();
    });
  }

  /* ------------------------------------------ public API for the TTS engine */

  window.UPSC_Reader = {
    get current() { return cur; },
    get last() { return last; },
    hasNext: hasNext,
    loadNext: loadNext,
    setScale: applyScale,
  };

  markActive(cur);
  initAutoLoad();
})();