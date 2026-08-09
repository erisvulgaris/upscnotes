/* UPSCbooks — Extras hub client.
   Data files live under content/<slug> and are served by /content
   (already auth-gated). We fetch-and-render exactly like the original
   offline site did with embedded window data.
*/
(function () {
  'use strict';

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  function norm(s) { return String(s || '').toLowerCase().replace(/[^\w\s-]/g, ' '); }
  function fetchJson(name) {
    return fetch('/content/' + window.EXTRAS.slug + '/' + name + '?v=' + Date.now()).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  // ---------- Quiz ----------
  function initQuiz() {
    var list = document.getElementById('q-list');
    if (!list) return;
    var count = document.getElementById('q-count');
    fetchJson('questions.json').then(function (data) {
      var all = data.questions || [];
      if (count) count.textContent = all.length + ' questions';
      render();
      function render() {
        var q = norm(document.getElementById('q-search').value);
        var ch = document.getElementById('q-ch').value;
        var kind = document.getElementById('q-kind').value;
        var style = document.getElementById('q-style').value;
        var out = all.filter(function (item) {
          if (ch && !(item.chapters || []).includes(Number(ch))) return false;
          if (kind && item.kind !== kind) return false;
          if (style && item.style !== style) return false;
          if (q) {
            var hay = norm(item.stem + ' ' + (item.body || []).join(' ') + ' ' + (item.explanation || ''));
            if (hay.indexOf(q) === -1) return false;
          }
          return true;
        });
        if (count) count.textContent = out.length + ' of ' + all.length + ' questions';
        list.innerHTML = out.length ? out.map(cardHtml).join('') : emptyHtml('No questions match those filters.');
      }
      var search = document.getElementById('q-search');
      ['q-ch', 'q-kind', 'q-style'].forEach(function (id) {
        document.getElementById(id).addEventListener('change', render);
      });
      search.addEventListener('input', render);
      document.addEventListener('click', function (e) {
        var btn = e.target.closest('.q-reveal');
        if (!btn) return;
        var card = btn.closest('.qcard');
        var correct = card.getAttribute('data-correct') || '';
        var fb = card.querySelector('.qfb');
        var opts = card.querySelectorAll('.qopt');
        opts.forEach(function (li) { li.classList.remove('correct', 'wrong'); });
        if (!correct) {
          if (fb) { fb.style.display = 'none'; }
          btn.textContent = 'Reveal answer';
          return;
        }
        opts.forEach(function (li) {
          var letter = li.getAttribute('data-letter');
          if (letter === correct) li.classList.add('correct');
          else li.classList.add('wrong');
        });
        if (fb) {
          if (btn.textContent === 'Reveal answer') {
            fb.textContent = 'Correct answer: ' + correct.toUpperCase();
            fb.style.display = '';
            btn.textContent = 'Hide answer';
          } else {
            fb.style.display = 'none';
            btn.textContent = 'Reveal answer';
          }
        } else {
          btn.textContent = btn.textContent === 'Reveal answer'
            ? 'Answer: ' + correct.toUpperCase()
            : 'Reveal answer';
        }
      });
    }).catch(function (e) {
      list.innerHTML = emptyHtml('This book has no question bank yet.');
    });
  }

  function kindBadge(kind) {
    var map = window.EXTRAS.kindLabels || {};
    if (kind === 'PYQ_Pre' || kind === 'FYQ_Pre') return '<span class="qbadge kind-pre">' + (map[kind] ? map[kind][0] : kind) + '</span>';
    if (kind === 'PYQ_M' || kind === 'FYQ_M') return '<span class="qbadge kind-main">' + (map[kind] ? map[kind][0] : kind) + '</span>';
    return '<span class="qbadge">' + esc(kind) + '</span>';
  }

  function cardHtml(q) {
    var labels = window.EXTRAS.kindLabels || {};
    var parts = [];
    parts.push('<article class="qcard"' + (q.id ? ' id="' + esc(q.id) + '"' : '') + (q.correct ? ' data-correct="' + esc(q.correct) + '"' : '') + '>');
    parts.push('<div class="qmeta">');
    parts.push(kindBadge(q.kind));
    parts.push('<span class="qbadge">' + esc(q.style || '') + '</span>');
    if (q.meta) parts.push('<span class="qbadge">' + esc(q.meta) + '</span>');
    (q.chapters || []).slice(0, 6).forEach(function (c) { parts.push('<span class="qbadge">Ch ' + esc(c) + '</span>'); });
    if (q.label) parts.push('<span class="qcount">' + esc(q.label) + '</span>');
    parts.push('</div>');
    if (q.stem) parts.push('<div class="qstem">' + esc(q.stem) + '</div>');
    if (q.items && q.items.length) {
      parts.push('<ol class="qitems">');
      q.items.forEach(function (it) { parts.push('<li>' + esc(it) + '</li>'); });
      parts.push('</ol>');
    }
    if (q.matchTable && q.matchTable.length) {
      parts.push('<div class="ex-tablewrap"><table class="ex-table">');
      q.matchTable.forEach(function (row, ri) {
        parts.push('<tr>' + row.map(function (cell, ci) {
          return (ri === 0 || ci === 0) ? '<th>' + esc(cell) + '</th>' : '<td>' + esc(cell) + '</td>';
        }).join('') + '</tr>');
      });
      parts.push('</table></div>');
    }
    if (q.body && q.body.length) {
      parts.push('<div class="qbody">');
      q.body.forEach(function (p) { parts.push('<p>' + esc(p) + '</p>'); });
      parts.push('</div>');
    }
    if (q.options && q.options.length && q.kind.indexOf('Pre') !== -1) {
      parts.push('<ul class="qoptions">');
      q.options.forEach(function (o) {
        parts.push('<li class="qopt" data-letter="' + esc(o.letter) + '"><span class="qopt-letter">' + esc(o.letter) + '</span><span>' + esc(o.text) + '</span></li>');
      });
      parts.push('</ul>');
    }
    if (q.kind && q.kind.indexOf('Pre') !== -1) {
      parts.push('<div class="q-actions"><button class="q-reveal">Reveal answer</button></div>');
      parts.push('<div class="qfb" style="display:none"></div>');
    }
    if (q.explanation) {
      parts.push('<details class="explain-toggle"><summary>Explanation</summary><div class="explain-body"><p>' + esc(q.explanation) + '</p></div></details>');
    }
    parts.push('</article>');
    return parts.join('');
  }

  function emptyHtml(msg) {
    return '<div class="ex-empty">' + esc(msg) + '</div>';
  }

  // ---------- Flashcards ----------
  function initFlash() {
    var grid = document.getElementById('fc-grid');
    if (!grid) return;
    var count = document.getElementById('fc-count');
    fetchJson('flashcards.json').then(function (data) {
      var all = data.cards || [];
      if (count) count.textContent = all.length + ' cards';
      render();
      function render() {
        var ch = document.getElementById('fc-ch').value;
        var type = document.getElementById('fc-type').value;
        var out = all.filter(function (c) {
          return (!ch || String(c.chapter) === ch) && (!type || c.type === type);
        });
        if (count) count.textContent = out.length + ' of ' + all.length + ' cards';
        grid.innerHTML = out.map(function (c) {
          return '<div class="fc-deck" data-id="' + esc(c.id) + '">' +
            '<div class="fc-inner">' +
            '<div class="fc-face"><span class="fc-deck-label">' + esc(c.front) + '</span><span class="fc-deck-meta">Ch ' + esc(c.chapter) + ' · ' + esc(c.type) + '</span></div>' +
            '<div class="fc-face fc-face-back"><span class="fc-deck-label">' + esc(c.back) + '</span><span class="fc-deck-meta">tap to flip</span></div>' +
            '</div></div>';
        }).join('') || emptyHtml('No cards match those filters.');
      }
      document.getElementById('fc-ch').addEventListener('change', render);
      document.getElementById('fc-type').addEventListener('change', render);
      grid.addEventListener('click', function (e) {
        var fc = e.target.closest('.fc-deck');
        if (fc) fc.classList.toggle('flipped');
      });
    }).catch(function () {
      grid.innerHTML = emptyHtml('This book has no flashcards yet.');
    });
  }

  // ---------- Maps ----------
  function initMaps() {
    var grid = document.getElementById('map-grid');
    if (!grid) return;
    Promise.all([fetchJson('maps.json'), fetchJson('map_pyqs.json').catch(function () { return {}; })])
      .then(function (res) {
        var data = res[0], pyqs = res[1] || {};
        var all = data.maps || [];
        render();
        function render() {
          var ch = document.getElementById('map-ch').value;
          var out = all.filter(function (m) { return !ch || String(m.chapter) === ch; });
          grid.innerHTML = out.map(function (m) {
            var normSrc = String(m.src || '').replace(/^\/c2\/[^/]+\//, '');
            var src = normSrc ? '/content/' + window.EXTRAS.slug + '/' + normSrc : '';
            var n = (pyqs[m.id] || []).length;
            return '<figure class="map-card" tabindex="0">' +
              (src ? '<img src="' + esc(src) + '" alt="' + esc(m.title) + '" loading="lazy" data-lb>' : '') +
              '<figcaption class="map-card-cap">' + esc(m.title) +
              (n ? ' <span class="muted" style="font-weight:400">· ' + n + ' PYQ link' + (n > 1 ? 's' : '') + '</span>' : '') +
              '</figcaption>' +
              (m.places && m.places.length ? '<div class="map-card-places">Places: ' + esc(m.places.join(', ')) + '</div>' : '') +
              '</figure>';
          }).join('') || emptyHtml('No maps match that chapter.');
        }
        document.getElementById('map-ch').addEventListener('change', render);
      })
      .catch(function () { grid.innerHTML = emptyHtml('This book has no maps yet.'); });
  }

  // ---------- Lightbox ----------
  function initLightbox() {
    var lb = document.getElementById('ex-lb');
    if (!lb) return;
    var img = document.getElementById('ex-lb-img');
    var cap = document.getElementById('ex-lb-cap');
    var close = document.getElementById('ex-lb-close');
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-lb]');
      if (t) {
        img.src = t.currentSrc || t.src;
        cap.textContent = t.alt || '';
        lb.hidden = false;
      } else if (e.target === lb || e.target === close) {
        lb.hidden = true;
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') lb.hidden = true;
    });
  }

  // ---------- Mains bank ----------
  function initMains() {
    var list = document.getElementById('mains-list');
    if (!list) return;
    fetchJson('mains_bank.json').then(function (data) {
      var all = data.entries || [];
      list.innerHTML = all.map(function (e, i) {
        var items = (e.items || []);
        return '<details class="mains-card"><summary class="mains-q">' + esc(e.text) + '</summary>' +
          '<div class="mains-meta">' + esc(e.source || '') + (e.type ? ' · ' + esc(e.type) : '') + '</div>' +
          (items.length ? '<ul class="mains-items">' + items.map(function (it) {
            return '<li><strong>Ch ' + esc(it.chapter) + '</strong> — ' + esc(it.title) + (it.sec ? ' <span class="muted">(secs ' + esc(String(it.sec)) + ')</span>' : '') + '</li>';
          }).join('') + '</ul>' : '') +
          '</details>';
      }).join('');
    }).catch(function () {
      list.innerHTML = emptyHtml('This book has no mains bank yet.');
    });
  }

  // ---------- Glossary filter ----------
  function initGlossary() {
    var list = document.getElementById('gl-list');
    if (!list) return;
    var items = list.querySelectorAll('.gl-item');
    var count = document.getElementById('gl-count');
    function apply() {
      var q = norm(document.getElementById('gl-search').value);
      var ch = document.getElementById('gl-ch').value;
      var n = 0;
      items.forEach(function (li) {
        var show = true;
        if (q && li.getAttribute('data-term').indexOf(q) === -1) show = false;
        if (show && ch && li.getAttribute('data-ch') !== ch) show = false;
        li.style.display = show ? '' : 'none';
        if (show) n++;
      });
      if (count) count.textContent = n + ' of ' + items.length;
    }
    document.getElementById('gl-search').addEventListener('input', apply);
    document.getElementById('gl-ch').addEventListener('change', apply);
    apply();
  }

  // ---------- Search ----------
  function initSearch() {
    var input = document.getElementById('s-q');
    var results = document.getElementById('s-results');
    var count = document.getElementById('s-count');
    if (!input || !results) return;
    fetchJson('sections_text.json').then(function (data) {
      var sections = data.sections || [];
      function run() {
        var q = norm(input.value).trim();
        var words = q.split(/\s+/).filter(function (w) { return w.length > 0; });
        if (!words.length) {
          results.innerHTML = '<p class="muted">Type a search term to find sections containing it.</p>';
          if (count) count.textContent = '';
          return;
        }
        var hits = [];
        for (var i = 0; i < sections.length; i++) {
          var s = sections[i];
          var hay = norm(s.norm || s.title || '') + ' ' + norm(s.title || '');
          if (words.every(function (w) { return hay.indexOf(w) !== -1; })) hits.push(s);
        }
        if (count) count.textContent = hits.length + ' sections';
        if (!hits.length) {
          results.innerHTML = emptyHtml('No sections matched. Try a different term.');
          return;
        }
        results.innerHTML = hits.slice(0, 100).map(function (s) {
          return '<a class="chcard" href="/read/' + window.EXTRAS.slug + '/' + s.chapter + '#sec-' + esc(s.id) + '">' +
            '<h2>' + esc(s.title) + '</h2>' +
            '<div class="res-meta">Ch ' + esc(s.chapter) + ' — ' + esc(s.chapterTitle) + ' · section ' + esc(s.id) + '</div>' +
            '</a>';
        }).join('');
      }
      input.addEventListener('input', run);
      run();
    }).catch(function () {
      results.innerHTML = emptyHtml('This book has no search index yet.');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof window.EXTRAS === 'undefined') return;
    initQuiz();
    initFlash();
    initMaps();
    initLightbox();
    initMains();
    initGlossary();
    initSearch();
  });
})();