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

  /* ------------------------------------------ study panel (bookmarks + notes) */

  var studyPanel = document.getElementById('rd-study');
  var studyOpen = document.getElementById('rd-study-open');
  var studyClose = document.getElementById('rd-study-close');
  var bmForm = document.getElementById('bm-form');
  var noteForm = document.getElementById('note-form');
  var bmList = document.getElementById('bm-list');
  var noteList = document.getElementById('note-list');
  var noteExport = document.getElementById('note-export');
  var tabs = document.querySelectorAll('.rd-study-tab');
  var panes = {
    bookmarks: document.getElementById('pane-bookmarks'),
    notes: document.getElementById('pane-notes'),
  };

  function openStudy() {
    if (!studyPanel) return;
    studyPanel.hidden = false;
    loadBookmarks();
    loadNotes();
  }
  function closeStudy() {
    if (!studyPanel) return;
    studyPanel.hidden = true;
  }
  function showTab(name) {
    tabs.forEach(function (t) {
      var active = t.getAttribute('data-tab') === name;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    Object.keys(panes).forEach(function (k) {
      panes[k].classList.toggle('is-active', k === name);
    });
  }

  if (studyOpen) studyOpen.addEventListener('click', openStudy);
  if (studyClose) studyClose.addEventListener('click', closeStudy);
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && studyPanel && !studyPanel.hidden) closeStudy();
  });

  function csrfToken() {
    var m = document.querySelector('meta[name="csrf"]');
    return m ? m.getAttribute('content') : '';
  }
  function api(url, opts) {
    var headers = { 'x-csrf-token': csrfToken() };
    if (opts && opts.json) headers['content-type'] = 'application/json';
    return fetch('/api' + url, { ...opts, headers }).then(function (r) { return r.ok ? r.json() : Promise.reject(r); });
  }

  function loadBookmarks() {
    api('/bookmarks/' + CFG.slug).then(function (data) {
      if (!bmList) return;
      var items = data.bookmarks || [];
      if (!items.length) { bmList.innerHTML = '<p class="rd-study-empty">No bookmarks yet.</p>'; return; }
      bmList.innerHTML = items.map(function (b) {
        return '<div class="rd-study-item" data-id="' + b.id + '">' +
          '<div class="rd-study-item-meta">Ch. ' + b.chapter_number + (b.label ? ' · ' + escHtml(b.label) : '') + ' · ' + fmtWhen(b.created_at) + '</div>' +
          '<div class="rd-study-item-actions"><button data-del="' + b.id + '">Delete</button></div>' +
        '</div>';
      }).join('');
    }).catch(function () {
      if (bmList) bmList.innerHTML = '<p class="rd-study-empty">Could not load bookmarks.</p>';
    });
  }

  function loadNotes() {
    api('/notes/' + CFG.slug).then(function (data) {
      if (!noteList) return;
      var items = data.notes || [];
      if (!items.length) { noteList.innerHTML = '<p class="rd-study-empty">No notes yet.</p>'; return; }
      noteList.innerHTML = items.map(function (n) {
        return '<div class="rd-study-item" data-id="' + n.id + '">' +
          '<div class="rd-study-item-meta">Ch. ' + n.chapter_number + ' · ' + fmtWhen(n.updated_at) + '</div>' +
          '<div class="rd-study-item-body">' + escHtml(n.body) + '</div>' +
          '<div class="rd-study-item-actions">' +
            '<button data-edit="' + n.id + '">Edit</button>' +
            '<button data-del="' + n.id + '">Delete</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }).catch(function () {
      if (noteList) noteList.innerHTML = '<p class="rd-study-empty">Could not load notes.</p>';
    });
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function fmtWhen(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
  }

  if (bmForm) {
    bmForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(bmForm);
      var data = {
        chapter: fd.get('chapter'),
        audioMs: fd.get('audioMs'),
        scrollPct: fd.get('scrollPct'),
        label: fd.get('label'),
      };
      api('/bookmarks/' + CFG.slug, { method: 'POST', json: true, body: JSON.stringify(data) })
        .then(function () { bmForm.reset(); loadBookmarks(); })
        .catch(function () { alert('Could not save bookmark.'); });
    });
  }

  if (noteForm) {
    noteForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(noteForm);
      var data = {
        chapter: fd.get('chapter'),
        audioMs: fd.get('audioMs'),
        scrollPct: fd.get('scrollPct'),
        body: fd.get('body'),
      };
      api('/notes/' + CFG.slug, { method: 'POST', json: true, body: JSON.stringify(data) })
        .then(function () { noteForm.reset(); loadNotes(); })
        .catch(function () { alert('Could not save note.'); });
    });
  }

  function deleteStudyItem(url) {
    if (!confirm('Delete this?')) return;
    api(url, { method: 'DELETE' }).then(function () {
      loadBookmarks();
      loadNotes();
    }).catch(function () { alert('Could not delete.'); });
  }

  bmList && bmList.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-del]');
    if (btn) deleteStudyItem('/bookmarks/' + CFG.slug + '/' + btn.getAttribute('data-del'));
  });
  noteList && noteList.addEventListener('click', function (e) {
    var del = e.target.closest('button[data-del]');
    var edit = e.target.closest('button[data-edit]');
    if (del) deleteStudyItem('/notes/' + CFG.slug + '/' + del.getAttribute('data-del'));
    if (edit) {
      var item = edit.closest('.rd-study-item');
      var bodyEl = item && item.querySelector('.rd-study-item-body');
      if (!bodyEl) return;
      var current = bodyEl.textContent;
      var ta = document.createElement('textarea');
      ta.className = 'rd-study-input';
      ta.rows = 3;
      ta.value = current;
      bodyEl.replaceWith(ta);
      ta.focus();
      var save = function () {
        var newBody = ta.value.trim();
        if (!newBody) { loadNotes(); return; }
        api('/notes/' + CFG.slug + '/' + edit.getAttribute('data-edit'), {
          method: 'PUT', json: true, body: JSON.stringify({ body: newBody }),
        }).then(loadNotes).catch(function () { alert('Could not update note.'); loadNotes(); });
      };
      ta.addEventListener('blur', save);
      ta.addEventListener('keydown', function (k) { if (k.key === 'Enter' && (k.metaKey || k.ctrlKey)) save(); });
    }
  });

  if (noteExport) {
    noteExport.addEventListener('click', function () {
      api('/notes/' + CFG.slug).then(function (data) {
        var items = data.notes || [];
        if (!items.length) { alert('No notes to export.'); return; }
        var md = '# ' + (CFG.title || CFG.slug) + ' — Notes\n\n';
        items.forEach(function (n) {
          md += '## Chapter ' + n.chapter_number + '\n';
          if (n.body) md += '\n' + n.body + '\n';
          md += '\n---\n\n';
        });
        var blob = new Blob([md], { type: 'text/markdown' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (CFG.slug || 'notes') + '-notes.md';
        a.click();
        URL.revokeObjectURL(a.href);
      }).catch(function () { alert('Could not load notes for export.'); });
    });
  }

  /* ------------------------------------------ reading themes */

  var themeBtn = document.getElementById('rd-theme');
  var themes = ['light', 'dark', 'sepia'];
  function currentTheme() {
    try { return localStorage.getItem('upscbooks-theme') || 'light'; } catch (e) { return 'light'; }
  }
  function applyTheme(name) {
    document.documentElement.setAttribute('data-theme', name);
    try { localStorage.setItem('upscbooks-theme', name); } catch (e) { /* ignore */ }
  }
  applyTheme(currentTheme());
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var idx = themes.indexOf(currentTheme());
      var next = themes[(idx + 1) % themes.length];
      applyTheme(next);
    });
  }

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