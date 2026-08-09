/* UPSCbooks reader: server-side rendered chapters, infinite-scroll to next chapter,
   chapter sidebar with live search, and a public hook the TTS module uses to
   continue playback across chapter boundaries without stopping. */
(function () {
  const readerEl = document.querySelector('.reader[data-slug]');
  if (!readerEl) return;

  const slug = readerEl.getAttribute('data-slug');
  const total = parseInt(readerEl.getAttribute('data-mih-total'), 10) || (window.UPSCBOOKS && window.UPSCBOOKS.total) || 0;
  let cur = parseInt(readerEl.getAttribute('data-mih-cur'), 10) || (window.UPSCBOOKS && window.UPSCBOOKS.cur) || 1;
  const rdBody = readerEl.querySelector('.rd-body');
  if (!rdBody) return;

  let loadingNext = null;
  let failCount = 0;
  const MAX_FAILS = 3;

  function maxSid() {
    let m = -1;
    rdBody.querySelectorAll('.tts-sent').forEach((el) => {
      const v = parseInt(el.getAttribute('data-sid'), 10);
      if (v > m) m = v;
    });
    return m;
  }

  function updateBookCur() {
    const el = document.querySelector('#book-cur');
    const title = el ? el.textContent : '';
    markActive(cur);
  }

  function nextExists() { return cur < total; }

  function statusEl() {
    let s = document.getElementById('mih-next-status');
    if (!s) {
      s = document.createElement('div');
      s.id = 'mih-next-status';
      s.className = 'mih-next-status';
      rdBody.appendChild(s);
    }
    return s;
  }

  function updateStatus() {
    const s = statusEl();
    if (cur >= total) {
      s.innerHTML = 'You have reached the end of this book.';
      s.classList.add('mih-end');
    } else {
      s.innerHTML = '<span class="pulse-dot"></span>Scroll to continue reading →';
      s.classList.remove('mih-end');
    }
  }

  function loadNext() {
    if (!nextExists()) return Promise.resolve(false);
    if (loadingNext) return loadingNext;
    const n = cur + 1;
    loadingNext = fetch(`/read/${slug}/${n}/fragment?sidBase=${maxSid() + 1}`, { credentials: 'same-origin' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then((html) => {
        const sep = document.createElement('div');
        sep.className = 'mih-next-chapter';
        sep.innerHTML = `<span class="mih-next-kicker">Chapter ${n}</span>`;
        const frag = document.createElement('div');
        frag.innerHTML = html;
        rdBody.appendChild(sep);
        rdBody.appendChild(frag);
        cur = n;
        updateStatus();
        return true;
      })
      .catch((err) => {
        failCount++;
        if (failCount <= MAX_FAILS) statusEl().textContent = 'Could not load the next chapter. Use the ▶ button or open chapters.';
        return false;
      })
      .finally(() => { loadingNext = null; });
    statusEl().textContent = 'Loading next chapter…';
    return loadingNext;
  }

  // IntersectionObserver: preload next chapter before the user reaches the bottom.
  function initAutoLoad() {
    updateStatus();
    if (!('IntersectionObserver' in window)) return;
    const sentinel = document.createElement('div');
    sentinel.className = 'mih-sentinel';
    sentinel.id = 'mih-sentinel';
    rdBody.appendChild(sentinel);
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) loadNext(); });
    }, { rootMargin: '1000px 0px' });
    io.observe(sentinel);
  }

  // ---- sidebar ----
  function openSb() { document.body.classList.add('mih-sb-open'); }
  function closeSb() { document.body.classList.remove('mih-sb-open'); }

  function markActive(n) {
    document.querySelectorAll('.mih-sb-item').forEach((item) => {
      item.classList.toggle('on', parseInt(item.getAttribute('data-n'), 10) === n);
    });
  }

  // Content search surfaces matches across the whole book from /api/search/:slug.
  const resPanel = document.getElementById('mih-sb-results');

  function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderResults(query, results) {
    if (!resPanel) return;
    if (!query) { resPanel.hidden = true; resPanel.innerHTML = ''; return; }
    const html = results.length
      ? results.map(function (r, i) {
          const deficit = r.snippet
            ? `<span class="mih-sb-snip">${escHtml(r.snippet)}</span>`
            : '';
          return `<a class="mih-sb-item mih-sb-rlink" data-n="${r.number}" href="/read/${slug}/${r.number}">
                    <span class="mih-sb-rtitle">Ch ${r.number}: ${escHtml(r.title)}</span>${deficit}</a>`;
        }).join('')
      : '<div class="mih-sb-empty">No matches for “' + escHtml(query) + '”.</div>';
    resPanel.innerHTML = html;
    resPanel.hidden = false;
  }

  function applyDesktop() {
    const on = window.matchMedia && window.matchMedia('(min-width: 1280px)').matches;
    document.body.classList.toggle('mih-sb-desktop', on);
  }

  function initSidebar() {
    const openBtn = document.getElementById('mih-open');
    const closeBtn = document.getElementById('mih-sb-close');
    const search = document.getElementById('mih-sb-search');
    const list = document.querySelector('.mih-sb-list');
    if (!search) return;
    if (openBtn) openBtn.addEventListener('click', openSb);
    if (closeBtn) closeBtn.addEventListener('click', closeSb);
    document.getElementById('mih-sb-backdrop')?.addEventListener?.('click', closeSb);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSb(); });

    let debounce = null;
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      // Single char: filter chapter titles live (no server round-trip).
      if (q.length <= 1) {
        clearTimeout(debounce);
        renderResults('', []);
        list?.querySelectorAll('.mih-sb-item').forEach((item) => {
          const hit = !q || (item.textContent + ' ' + item.getAttribute('data-n')).toLowerCase().includes(q);
          item.style.display = hit ? '' : 'none';
        });
        return;
      }
      // 2+ chars: show “Searching…” then draw results from the server.
      list?.querySelectorAll('.mih-sb-item').forEach((item) => { item.style.display = 'none'; });
      renderResults(q, []);
      if (resPanel) {
        resPanel.innerHTML = '<div class="mih-sb-empty">Searching…</div>';
        resPanel.hidden = false;
      }
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        try {
          const r = await fetch(`/api/search/${slug}?q=${encodeURIComponent(q)}`, { credentials: 'same-origin' });
          const data = await r.json();
          renderResults(q, data.ok ? data.results : []);
        } catch (e) {
          if (resPanel) { resPanel.innerHTML = '<div class="mih-sb-empty">Search failed. Try again.</div>'; resPanel.hidden = false; }
        }
      }, 250);
    });
  }

  // ---- public API for tts.js ----
  window.UPSC_Reader = {
    get current() { return cur; },
    get total() { return total; },
    hasNext() { return nextExists(); },
    loadNext() { return loadNext(); },
  };

  initSidebar();
  markActive(cur);
  applyDesktop();
  if (window.matchMedia) window.matchMedia('(min-width: 1280px)').addEventListener('change', applyDesktop);
  initAutoLoad();
})();
