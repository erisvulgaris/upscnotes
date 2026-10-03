/* =====================================================================
   UPSCbooks — study tools client
   The data bundles live under content/<slug> and are served by /content,
   which is already auth- and subscription-gated. Everything renders
   client-side so a filter never costs a full page load.
   ===================================================================== */
(function () {
  'use strict';

  var EX = window.EXTRAS;
  if (!EX) return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^\w\s-]/g, ' ');
  }
  function slug() { return encodeURIComponent(EX.slug); }

  var jsonCache = {};
  function fetchJson(name) {
    if (jsonCache[name]) return jsonCache[name];
    // The cache-buster keeps a refreshed data file from being shadowed by
    // the browser while a session is open.
    jsonCache[name] = fetch('/content/' + slug() + '/' + name + '?v=' + Date.now())
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    return jsonCache[name];
  }

  function empty(msg) { return '<div class="ex-empty">' + esc(msg) + '</div>'; }
  function setCount(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /* ---------------------------------------------------- shared lightbox */
  function initLightbox() {
    var lb = document.getElementById('ex-lb');
    if (!lb) return;
    var img = document.getElementById('ex-lb-img');
    var cap = document.getElementById('ex-lb-cap');
    var close = document.getElementById('ex-lb-close');
    var lastFocus = null;

    function open(src, alt) {
      lastFocus = document.activeElement;
      img.src = src;
      img.alt = alt || '';
      cap.textContent = alt || '';
      lb.hidden = false;
      close.focus();
    }
    function hide() {
      lb.hidden = true;
      img.src = '';
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-lb]') : null;
      if (t) { open(t.currentSrc || t.src, t.alt || ''); return; }
      if (!lb.hidden && (e.target === lb || e.target.closest('#ex-lb-close'))) hide();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !lb.hidden) hide();
    });
  }

  /* ------------------------------------------------------------- quiz */
  function initQuiz() {
    var list = document.getElementById('q-list');
    if (!list) return;

    fetchJson('questions.json').then(function (data) {
      var all = (data && data.questions) || [];
      var search = document.getElementById('q-search');
      var ch = document.getElementById('q-ch');
      var kind = document.getElementById('q-kind');
      var style = document.getElementById('q-style');

      function render() {
        var q = norm(search.value).trim();
        var chV = ch.value;
        var kindV = kind.value;
        var styleV = style.value;

        var out = all.filter(function (item) {
          if (chV && !(item.chapters || []).indexOf(Number(chV)) && !(item.chapters || []).includes(Number(chV))) return false;
          if (kindV && item.kind !== kindV) return false;
          if (styleV && item.style !== styleV) return false;
          if (q) {
            var hay = norm(item.stem + ' ' + (item.body || []).join(' ') + ' ' + (item.explanation || ''));
            if (hay.indexOf(q) === -1) return false;
          }
          return true;
        });

        setCount('q-count', out.length === all.length
          ? all.length + ' questions'
          : out.length + ' of ' + all.length + ' questions');
        list.innerHTML = out.length ? out.map(cardHtml).join('') : empty('No questions match those filters.');
      }

      function cardHtml(q) {
        var labels = EX.kindLabels || {};
        var parts = [];
        parts.push('<article class="qcard"' + (q.id ? ' id="' + esc(q.id) + '"' : '') +
          (q.correct ? ' data-correct="' + esc(q.correct) + '"' : '') + '>');

        parts.push('<div class="qmeta">');
        var kind = q.kind || '';
        if (/^PYQ_Pre$|^FYQ_Pre$/.test(kind)) {
          parts.push('<span class="qbadge kind-pre">' + esc(labels[kind] ? labels[kind][0] : kind) + '</span>');
        } else if (/^PYQ_M$|^FYQ_M$/.test(kind)) {
          parts.push('<span class="qbadge kind-main">' + esc(labels[kind] ? labels[kind][0] : kind) + '</span>');
        }
        if (q.style) parts.push('<span class="qbadge">' + esc(q.style) + '</span>');
        if (q.meta) parts.push('<span class="qbadge">' + esc(q.meta) + '</span>');
        (q.chapters || []).slice(0, 6).forEach(function (c) { parts.push('<span class="qbadge">Ch ' + esc(c) + '</span>'); });
        parts.push('</div>');

        if (q.stem) parts.push('<div class="qstem">' + esc(q.stem) + '</div>');

        if (q.matchTable && q.matchTable.length) {
          parts.push('<div class="ex-tablewrap"><table class="ex-table"><tbody>');
          q.matchTable.forEach(function (row, ri) {
            parts.push('<tr>' + row.map(function (cell, ci) {
              return (ri === 0 || ci === 0) ? '<th>' + esc(cell) + '</th>' : '<td>' + esc(cell) + '</td>';
            }).join('') + '</tr>');
          });
          parts.push('</tbody></table></div>');
        }

        if (q.body && q.body.length) {
          parts.push('<div class="qbody">' + q.body.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>');
        }
        if (q.items && q.items.length) {
          parts.push('<ol class="qitems">' + q.items.map(function (it) { return '<li>' + esc(it) + '</li>'; }).join('') + '</ol>');
        }
        if (q.options && q.options.length && kind.indexOf('Pre') !== -1) {
          parts.push('<ul class="qoptions">' + q.options.map(function (o) {
            return '<li class="qopt" data-letter="' + esc(o.letter) + '">' +
              '<span class="qopt-letter">' + esc(o.letter) + '</span>' +
              '<span>' + esc(o.text) + '</span></li>';
          }).join('') + '</ul>');
        }
        if (kind.indexOf('Pre') !== -1) {
          parts.push('<div class="q-actions"><button class="btn btn-ghost btn-sm" type="button">Reveal answer</button></div>');
          parts.push('<div class="qfb" hidden></div>');
        }
        if (q.explanation) {
          parts.push('<details class="explain-toggle"><summary>Explanation</summary>' +
            '<div class="explain-body"><p>' + esc(q.explanation) + '</p></div></details>');
        }
        parts.push('</article>');
        return parts.join('');
      }

      [search, ch, kind, style].forEach(function (el) {
        el.addEventListener(el === search ? 'input' : 'change', render);
      });

      list.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.q-actions button') : null;
        if (!btn) return;
        var card = btn.closest('.qcard');
        var correct = card.getAttribute('data-correct') || '';
        var fb = card.querySelector('.qfb');
        var opts = card.querySelectorAll('.qopt');

        if (!correct) { btn.textContent = 'Reveal answer'; return; }
        var showing = fb && !fb.hidden;

        Array.prototype.forEach.call(opts, function (li) { li.classList.remove('correct', 'wrong'); });
        if (showing) {
          if (fb) fb.hidden = true;
          btn.textContent = 'Reveal answer';
          return;
        }
        Array.prototype.forEach.call(opts, function (li) {
          li.classList.add(li.getAttribute('data-letter') === correct ? 'correct' : 'wrong');
        });
        if (fb) {
          fb.textContent = 'Correct answer: ' + correct.toUpperCase();
          fb.hidden = false;
        }
        btn.textContent = 'Hide answer';
      });

      render();
    }).catch(function () {
      list.innerHTML = empty('This book has no question bank yet.');
      setCount('q-count', '');
    });
  }

  /* ------------------------------------------------------- flashcards */
  function initFlash() {
    var grid = document.getElementById('fc-grid');
    if (!grid) return;

    fetchJson('flashcards.json').then(function (data) {
      var all = (data && data.cards) || [];
      var ch = document.getElementById('fc-ch');
      var type = document.getElementById('fc-type');

      function render() {
        var chV = ch.value;
        var typeV = type.value;
        var out = all.filter(function (c) {
          return (!chV || String(c.chapter) === chV) && (!typeV || c.type === typeV);
        });
        setCount('fc-count', out.length === all.length
          ? all.length + ' cards'
          : out.length + ' of ' + all.length + ' cards');

        // Cap the initial paint so a 3,000-card book stays responsive.
        var shown = out.slice(0, 60);
        grid.innerHTML = shown.map(function (c) {
          return '<div class="fc-deck" data-id="' + esc(c.id) + '">' +
            '<div class="fc-inner">' +
              '<div class="fc-face"><span class="fc-deck-label">' + esc(c.front) + '</span>' +
                '<span class="fc-deck-meta">Ch ' + esc(c.chapter) + (c.type ? ' · ' + esc(c.type) : '') + '</span></div>' +
              '<div class="fc-face fc-face-back"><span class="fc-deck-label">' + esc(c.back) + '</span>' +
                '<span class="fc-deck-meta">tap to flip back</span></div>' +
            '</div></div>';
        }).join('');

        if (out.length > shown.length) {
          var more = document.createElement('button');
          more.className = 'btn btn-ghost btn-block';
          more.type = 'button';
          more.style.marginTop = 'var(--sp-5)';
          more.textContent = 'Show ' + Math.min(120, out.length - shown.length) + ' more';
          more.addEventListener('click', function () {
            more.remove();
            grid.insertAdjacentHTML('beforeend', shown.length === 60
              ? out.slice(60, 180).map(function (c) {
                  return '<div class="fc-deck"><div class="fc-inner">' +
                    '<div class="fc-face"><span class="fc-deck-label">' + esc(c.front) + '</span>' +
                    '<span class="fc-deck-meta">Ch ' + esc(c.chapter) + '</span></div>' +
                    '<div class="fc-face fc-face-back"><span class="fc-deck-label">' + esc(c.back) + '</span>' +
                    '<span class="fc-deck-meta">tap to flip back</span></div></div></div>';
                }).join('')
              : '');
          });
          grid.appendChild(more);
        }
        if (!out.length) grid.innerHTML = empty('No cards match those filters.');
      }

      ch.addEventListener('change', render);
      type.addEventListener('change', render);
      grid.addEventListener('click', function (e) {
        var fc = e.target.closest ? e.target.closest('.fc-deck') : null;
        if (fc) fc.classList.toggle('flipped');
      });
      render();
    }).catch(function () {
      grid.innerHTML = empty('This book has no flashcards yet.');
      setCount('fc-count', '');
    });
  }

  /* -------------------------------------------------------------- maps */
  function initMaps() {
    var grid = document.getElementById('map-grid');
    if (!grid) return;

    Promise.all([
      fetchJson('maps.json'),
      fetchJson('map_pyqs.json').catch(function () { return {}; }),
    ]).then(function (res) {
      var all = (res[0] && res[0].maps) || [];
      var pyqs = res[1] || {};
      var ch = document.getElementById('map-ch');

      function render() {
        var chV = ch.value;
        var out = all.filter(function (m) { return !chV || String(m.chapter) === chV; });
        setCount('map-count', out.length === all.length
          ? all.length + ' maps'
          : out.length + ' of ' + all.length + ' maps');

        if (!out.length) { grid.innerHTML = empty('No maps match that chapter.'); return; }

        grid.innerHTML = out.map(function (m) {
          var normSrc = String(m.src || '').replace(/^\/c2\/[^/]+\//, '').replace(/^\.\.\//, '');
          var src = normSrc ? '/content/' + slug() + '/' + normSrc : '';
          var n = (pyqs[m.id] || []).length;
          return '<figure class="map-card" tabindex="0" role="button" aria-label="' + esc(m.title) + ' — open larger">' +
            (src ? '<img src="' + esc(src) + '" alt="' + esc(m.title) + '" loading="lazy" decoding="async" data-lb>'
                  : '<div class="ex-empty">Image unavailable</div>') +
            '<figcaption class="map-card-cap">' + esc(m.title) +
            (n ? ' <span class="muted">· ' + n + ' PYQ link' + (n > 1 ? 's' : '') + '</span>' : '') +
            '</figcaption>' +
            (m.places && m.places.length
              ? '<div class="map-card-places">' + esc(m.places.join(' · ')) + '</div>' : '') +
            '</figure>';
        }).join('');
      }

      ch.addEventListener('change', render);
      render();
    }).catch(function () {
      grid.innerHTML = empty('This book has no maps yet.');
      setCount('map-count', '');
    });
  }

  /* -------------------------------------------------------- timeline */
  function initTimeline() {
    var list = document.getElementById('tl-list');
    if (!list) return;

    var search = document.getElementById('tl-q');
    var erasBox = document.getElementById('tl-eras');
    var landmarks = [];
    try { landmarks = JSON.parse(list.getAttribute('data-landmarks') || '[]'); } catch (e) { landmarks = []; }

    if (erasBox && landmarks.length) {
      erasBox.hidden = false;
      erasBox.innerHTML = landmarks.filter(Boolean)
        .map(function (l) { return '<span class="chip chip-gold">' + esc(l) + '</span>'; }).join('');
    }

    fetchJson('mindmaps.json').then(function (data) {
      var tl = (data && data.timeline) || {};
      var all = Array.isArray(tl.events) ? tl.events : [];
      // Precompute the search haystack once — this list can be very large.
      var rows = all.map(function (e) {
        return {
          e: e,
          hay: norm([e.label, e.when && e.when.display, e.when && e.when.year, e.ch].join(' ')),
          year: (e.when && (e.when.year || e.when.display)) || '',
        };
      });

      function render() {
        var q = norm(search.value).trim();
        var out = q ? rows.filter(function (r) { return r.hay.indexOf(q) !== -1; }) : rows;

        setCount('tl-count', out.length === rows.length
          ? (rows.length + ' dated events')
          : (out.length + ' of ' + rows.length + ' events'));

        var CAP = 250;
        var slice = out.slice(0, CAP);
        list.innerHTML = slice.length
          ? slice.map(function (r) {
              var e = r.e;
              var when = e.when && (e.when.display || e.when.year) ? (e.when.display || e.when.year) : (e.when || '');
              return '<li class="tl-item">' +
                '<span class="tl-year">' + esc(when) + '</span>' +
                '<span class="tl-label">' + esc(e.label) + '</span>' +
                (e.ch ? '<a class="tl-link" href="/read/' + slug() + '/' + esc(e.ch) + '">Ch ' + esc(e.ch) + '</a>' : '<span></span>') +
                '</li>';
            }).join('')
          : empty('No events match that search.');

        if (out.length > CAP) {
          var note = document.createElement('li');
          note.className = 'tl-more';
          note.textContent = 'Showing the first ' + CAP + ' of ' + out.length +
            ' events — narrow the search to see the rest.';
          list.appendChild(note);
        }
      }

      var timer = null;
      search.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(render, 160);
      });
      render();
    }).catch(function () {
      list.innerHTML = empty('This book has no timeline data yet.');
      setCount('tl-count', '');
    });
  }

  /* -------------------------------------------------------- mains bank */
  function initMains() {
    var list = document.getElementById('mains-list');
    if (!list) return;

    fetchJson('mains_bank.json').then(function (data) {
      var all = (data && data.entries) || [];
      setCount('mains-count', all.length + ' prompts');
      if (!all.length) { list.innerHTML = empty('This book has no mains bank yet.'); return; }

      list.innerHTML = all.slice(0, 80).map(function (e) {
        var items = e.items || [];
        return '<details class="mains-card"><summary>' + esc(e.text) + '</summary>' +
          '<div class="mains-meta">' + esc(e.source || '') + (e.type ? ' · ' + esc(e.type) : '') + '</div>' +
          (items.length
            ? '<ul class="mains-items">' + items.map(function (it) {
                return '<li><a href="/read/' + slug() + '/' + esc(it.chapter) + '">Ch ' + esc(it.chapter) + '</a> — ' +
                  esc(it.title) + (it.sec ? ' <span class="muted">(sec ' + esc(String(it.sec)) + ')</span>' : '') + '</li>';
              }).join('') + '</ul>'
            : '') +
          '</details>';
      }).join('');
    }).catch(function () {
      list.innerHTML = empty('This book has no mains bank yet.');
      setCount('mains-count', '');
    });
  }

  /* ---------------------------------------------------------- glossary */
  function initGlossary() {
    var list = document.getElementById('gl-list');
    if (!list) return;

    var search = document.getElementById('gl-search');
    var ch = document.getElementById('gl-ch');
    var chapters = [];
    try { chapters = JSON.parse(list.getAttribute('data-chapters') || '[]'); } catch (e) { chapters = []; }
    var byNumber = {};
    chapters.forEach(function (c) { byNumber[c.number] = c.title; });

    fetchJson('palette_terms.json').then(function (terms) {
      terms = Array.isArray(terms) ? terms : [];
      setCount('gl-count', terms.length + ' key terms');

      var LIMIT = 200;
      var shown = terms.slice(0, LIMIT);

      function row(t) {
        return '<li class="gl-item" data-term="' + esc(String(t.term || '').toLowerCase()) +
          '" data-ch="' + esc(t.chapter) + '">' +
          '<a class="gl-term" href="/read/' + slug() + '/' + esc(t.chapter) + '#sec-' + esc(t.sec) + '">' + esc(t.term) + '</a>' +
          '<span class="gl-loc muted">Ch ' + esc(t.chapter) +
            (byNumber[t.chapter] ? ' · ' + esc(byNumber[t.chapter]) : '') +
            (t.secTitle ? ' — ' + esc(t.secTitle) : '') + '</span></li>';
      }

      function render() {
        var q = norm(search.value).trim();
        var chV = ch.value;
        var out = terms.filter(function (t) {
          if (chV && String(t.chapter) !== chV) return false;
          if (q && String(t.term || '').toLowerCase().indexOf(q) === -1) return false;
          return true;
        });
        setCount('gl-count', out.length === terms.length
          ? terms.length + ' key terms'
          : out.length + ' of ' + terms.length + ' key terms');

        var slice = out.slice(0, LIMIT);
        list.innerHTML = slice.length
          ? slice.map(row).join('')
          : empty('No terms match that search.');
      }

      search.addEventListener('input', render);
      ch.addEventListener('change', render);
      render();
    }).catch(function () {
      list.innerHTML = empty('This book has no glossary yet.');
      setCount('gl-count', '');
    });
  }

  /* ------------------------------------------------------------ search */
  function initSearch() {
    var input = document.getElementById('s-q');
    var results = document.getElementById('s-results');
    if (!input || !results) return;

    fetchJson('sections_text.json').then(function (data) {
      var sections = (data && data.sections) || [];
      var prebuilt = sections.map(function (s) {
        return { s: s, hay: norm(s.norm || s.title || '') + ' ' + norm(s.title || '') };
      });

      function run() {
        var q = norm(input.value).trim();
        var words = q.split(/\s+/).filter(Boolean);
        if (!words.length) {
          results.innerHTML = '<p class="muted">Type a search term to find sections containing it.</p>';
          setCount('s-count', '');
          return;
        }
        var hits = [];
        for (var i = 0; i < prebuilt.length; i++) {
          var hay = prebuilt[i].hay;
          var ok = true;
          for (var w = 0; w < words.length; w++) {
            if (hay.indexOf(words[w]) === -1) { ok = false; break; }
          }
          if (ok) hits.push(prebuilt[i].s);
          if (hits.length > 300) break;
        }
        setCount('s-count', hits.length + (hits.length > 300 ? '+ sections' : ' sections'));
        if (!hits.length) { results.innerHTML = empty('No sections matched. Try a different term.'); return; }
        results.innerHTML = hits.slice(0, 100).map(function (s) {
          return '<a class="chcard" href="/read/' + slug() + '/' + esc(s.chapter) + '#sec-' + esc(s.id) + '">' +
            '<h3>' + esc(s.title) + '</h3>' +
            '<div class="res-meta">Ch ' + esc(s.chapter) + (s.chapterTitle ? ' — ' + esc(s.chapterTitle) : '') +
              ' · section ' + esc(s.id) + '</div></a>';
        }).join('');
      }

      var timer = null;
      input.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(run, 180);
      });
      run();
    }).catch(function () {
      results.innerHTML = empty('This book has no search index yet.');
      setCount('s-count', '');
    });
  }

  function boot() {
    initLightbox();
    initQuiz();
    initFlash();
    initMaps();
    initTimeline();
    initMains();
    initGlossary();
    initSearch();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();