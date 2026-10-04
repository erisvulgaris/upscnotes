/* =====================================================================
   UPSCbooks — audio fallback

   Preferred path is the device's own speech engine (tts.js): it is free,
   offline, and knows exactly when it starts and ends each sentence.

   This file takes over only when the browser has **no usable voice** —
   older WebKit, some in-app browsers, locked-down enterprise builds, and
   headless environments. It then streams the pre-rendered 16 kHz Opus from
   audio/<slug>/<chapter>.opus.

   The hard part is the highlight. The cached sidecars were generated from
   narrationText()'s chunking, which includes section titles, table cells and
   captions that the reader never highlights, so sidecar index i is NOT the
   i-th highlighted sentence. Across 92 sampled chapters not one lined up and
   the lists differed by 12%: the audio said one sentence while another was
   lit up.

   audio/<slug>/<chapter>.sync.json is the corrected timeline, built by
   tools/tts/fix-sync.mjs by locating each highlighted sentence inside the
   spoken stream. It is used when present. If it is missing, the same
   alignment is computed here in the browser from the DOM and the sidecar, so
   a chapter without an index still highlights correctly rather than drifting.
   ===================================================================== */
(function () {
  'use strict';

  var main = document.getElementById('rd-body');
  if (!main) return;

  var slug = main.getAttribute('data-slug');
  var chapter = main.getAttribute('data-chapter');
  if (!slug || !chapter) return;

  var dock = document.getElementById('tts-dock');
  var playBtn = document.getElementById('tts-play');
  var panelBtn = document.getElementById('tts-toggle');
  var prevBtn = document.getElementById('tts-prev');
  var nextBtn = document.getElementById('tts-next');
  var stopBtn = document.getElementById('tts-stop');
  var nowEl = document.getElementById('tts-now');
  var posEl = document.getElementById('tts-pos');
  var fillEl = document.getElementById('tts-fill');

  var audio = null;
  var starts = null;        // starts[i] = seconds when sentence i begins
  var sentences = [];       // .tts-sent elements, ordered by data-sid
  var idx = -1;
  var mode = 'idle';        // idle | loading | playing | paused
  var seeking = false;
  // Zeroing currentTime fires a timeupdate, which would light sentence 0
  // straight back up over the reset.
  var suppressed = false;
  var source = '';

  var PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
  var PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><rect x="7" y="5" width="3.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="3.5" height="14" rx="1.2"/></svg>';
  var LOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" width="20" height="20" aria-hidden="true"><path d="M12 3v4M12 17v4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M3 12h4M17 12h4M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>';

  /* ------------------------------------------------------- alignment */

  function norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[^a-z0-9ऀ-ॿ]+/g, ' ')
      .trim();
  }

  function orderedSentences() {
    var out = [];
    document.querySelectorAll('.tts-sent').forEach(function (el) { out.push(el); });
    out.sort(function (a, b) {
      return (+a.getAttribute('data-sid')) - (+b.getAttribute('data-sid'));
    });
    return out;
  }

  /**
   * Locate each highlighted sentence inside the spoken stream.
   * Same walk as tools/tts/fix-sync.mjs, for chapters with no index file.
   */
  function alignLocally(timings, duration) {
    var nAudio = timings.map(function (x) { return norm(x.text); });
    var spans = [];
    var stream = '';
    for (var i = 0; i < timings.length; i++) {
      if (!nAudio[i]) continue;
      var start = stream.length + 1;
      stream += (stream ? ' ' : '') + nAudio[i];
      spans.push({ start: start, end: stream.length, t: timings[i].t });
    }
    for (var k = 0; k < spans.length; k++) {
      var nx = spans[k + 1];
      var end = nx ? nx.t : duration;
      if (end <= spans[k].t) end = Math.min(duration, spans[k].t + 1);
      spans[k].tNext = end;
    }

    var out = new Array(sentences.length);
    var cursor = 0, prev = 0, matched = 0;
    for (var d = 0; d < sentences.length; d++) {
      var nd = norm(sentences[d].textContent);
      if (!nd) { out[d] = prev; continue; }
      var at = stream.indexOf(nd, cursor);
      if (at === -1) at = stream.indexOf(nd, 0);
      if (at === -1) { out[d] = prev; continue; }

      var lo = 0, hi = spans.length - 1, si = 0;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (spans[mid].start <= at) { si = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      var sp = spans[si];
      var width = Math.max(1, sp.end - sp.start);
      var frac = Math.max(0, Math.min(1, (at - sp.start) / width));
      var t = sp.t + frac * (sp.tNext - sp.t);
      matched++;
      cursor = at + nd.length;
      if (t < prev) t = prev;
      if (t > duration) t = duration;
      out[d] = t;
      prev = t;
    }
    return { starts: out, matched: matched };
  }

  /** Which highlighted sentence is being spoken at time t. */
  function sentenceAt(t) {
    if (!starts || !starts.length) return -1;
    var lo = 0, hi = starts.length - 1, best = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (starts[mid] <= t) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return best;
  }

  /* ------------------------------------------------------------- paint */

  function paint() {
    if (!starts || !starts.length) return;
    posEl.textContent = (idx + 1) + ' / ' + sentences.length;
    fillEl.style.width = (idx < 0 ? 0 : (idx / sentences.length) * 100).toFixed(1) + '%';
    sentences.forEach(function (el, i) {
      el.classList.toggle('is-active', i === idx);
      if (i < idx) el.classList.add('is-done'); else el.classList.remove('is-done');
    });
    var cur = sentences[idx];
    if (cur && nowEl) nowEl.textContent = (cur.textContent || '').slice(0, 90);

    var follow = document.getElementById('tts-autoscroll');
    if (cur && follow && follow.getAttribute('aria-pressed') !== 'false' &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      try { cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { cur.scrollIntoView(); }
    }
  }

  function setButton(icon) {
    if (playBtn) playBtn.innerHTML = icon;
  }

  /* -------------------------------------------------------------- load */

  function load() {
    if (mode !== 'idle') return Promise.resolve();
    mode = 'loading';
    setButton(LOAD_ICON);
    if (nowEl) nowEl.textContent = 'Loading narration';

    var base = '/audio/' + encodeURIComponent(slug) + '/' + encodeURIComponent(chapter);

    return Promise.all([
      fetch(base + '.sync.json', { credentials: 'same-origin' }).then(function (r) {
        return r.ok ? r.json() : null;
      }).catch(function () { return null; }),
      fetch(base + '.json', { credentials: 'same-origin' }).then(function (r) {
        return r.ok ? r.json() : null;
      }).catch(function () { return null; }),
    ]).then(function (both) {
      var sync = both[0];
      var side = both[1];
      sentences = orderedSentences();
      if (!sentences.length) { setButton(PLAY_ICON); return; }

      if (sync && Array.isArray(sync.starts) && sync.starts.length === sentences.length) {
        starts = sync.starts;
        source = 'index';
      } else if (side && Array.isArray(side.sentenceTimings) && side.sentenceTimings.length) {
        // No index for this chapter: align in the browser rather than trust
        // sidecar indices, which do not correspond to the highlight.
        var r = alignLocally(side.sentenceTimings, side.duration || 0);
        starts = r.starts;
        source = 'aligned in page (' + r.matched + '/' + sentences.length + ')';
      } else {
        setButton(PLAY_ICON);
        if (nowEl) nowEl.textContent = 'No narration for this chapter';
        return;
      }

      audio = new Audio((side && side.url) || (base + '.opus'));
      // "metadata", not "auto": the heaviest chapter is 49MB, and preloading
      // it whole would mean waiting minutes before the first sentence.
      audio.preload = 'metadata';

      audio.addEventListener('timeupdate', function () {
        if (seeking || suppressed) return;
        var i = sentenceAt(audio.currentTime);
        if (i !== idx) { idx = i; paint(); }
      });
      audio.addEventListener('ended', function () {
        mode = 'idle';
        setButton(PLAY_ICON);
        if (nowEl) nowEl.textContent = 'End of narration';
      });
      audio.addEventListener('error', function () {
        mode = 'idle';
        setButton(PLAY_ICON);
        if (nowEl) nowEl.textContent = 'Narration failed to load';
      });

      return audio.play().then(function () {
        mode = 'playing';
        setButton(PAUSE_ICON);
        if (playBtn) playBtn.setAttribute('aria-label', 'Pause narration');
        paint();
      });
    }).catch(function () {
      mode = 'idle';
      setButton(PLAY_ICON);
      if (nowEl) nowEl.textContent = 'Narration could not be loaded';
    });
  }

  /* ----------------------------------------------------------- actions */

  function toggle() {
    if (!audio) return load();
    if (audio.paused) {
      suppressed = false;
      audio.play().then(function () {
        mode = 'playing';
        setButton(PAUSE_ICON);
        if (playBtn) playBtn.setAttribute('aria-label', 'Pause narration');
      }).catch(function () { /* keep paused */ });
    } else {
      audio.pause();
      mode = 'paused';
      setButton(PLAY_ICON);
      if (playBtn) playBtn.setAttribute('aria-label', 'Resume narration');
    }
  }

  function seekSentence(delta) {
    if (!audio || !starts || !starts.length) return;
    var target = Math.max(0, Math.min(starts.length - 1, (idx < 0 ? 0 : idx) + delta));
    seeking = true;
    suppressed = false;
    audio.currentTime = starts[target];
    idx = target;
    paint();
    setTimeout(function () { seeking = false; }, 120);
  }

  function stop() {
    suppressed = true;
    if (audio) { audio.pause(); audio.currentTime = 0; }
    idx = -1;
    mode = 'idle';
    setButton(PLAY_ICON);
    if (playBtn) playBtn.setAttribute('aria-label', 'Play narration');
    paint();
    if (nowEl) nowEl.textContent = 'Stopped';
  }

  /* ------------------------------------------------------------ wiring */

  function attach() {
    if (!dock) return;
    dock.hidden = false;
    if (playBtn) {
      playBtn.addEventListener('click', function (e) {
        e.stopImmediatePropagation();
        toggle();
      }, true);
    }
    if (prevBtn) prevBtn.addEventListener('click', function (e) { e.stopImmediatePropagation(); seekSentence(-1); }, true);
    if (nextBtn) nextBtn.addEventListener('click', function (e) { e.stopImmediatePropagation(); seekSentence(1); }, true);
    if (stopBtn) stopBtn.addEventListener('click', function (e) { e.stopImmediatePropagation(); stop(); }, true);

    // The options panel belongs to the Web Speech engine; hide what the
    // fallback cannot honour rather than offering dead controls.
    var voice = document.getElementById('tts-voice');
    if (voice && voice.closest('.tts-panel-row')) voice.closest('.tts-panel-row').hidden = true;
    var rate = document.querySelector('[data-rate]');
    if (rate && rate.closest('.tts-panel-row')) rate.closest('.tts-panel-row').hidden = true;
    var follow = document.getElementById('tts-autoscroll');
    if (follow) follow.setAttribute('aria-pressed', 'true');

    var sr = document.getElementById('tts-sr');
    if (!sr) {
      sr = document.createElement('p');
      sr.id = 'tts-sr';
      sr.className = 'sr-only';
      sr.setAttribute('role', 'status');
      sr.setAttribute('aria-live', 'polite');
      dock.appendChild(sr);
    }
    sr.textContent = 'Using recorded narration. Your browser has no working speech voice.';
    setButton(PLAY_ICON);
    if (nowEl) nowEl.textContent = 'Narration ready';
  }

  /* --------------------------------------------------- activation */

  function webSpeechUsable() {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return false;
    try { return window.speechSynthesis.getVoices().length > 0; } catch (e) { return false; }
  }

  function decide() {
    if (webSpeechUsable()) return;    // tts.js keeps control
    if (!audio && mode === 'idle') attach();
  }

  decide();
  if ('speechSynthesis' in window && window.speechSynthesis.addEventListener) {
    window.speechSynthesis.addEventListener('voiceschanged', decide);
  }
  setTimeout(decide, 1200);

  // Keyboard parity with the Web Speech path.
  document.addEventListener('keydown', function (e) {
    if (!audio) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === ' ' || e.key === 'k' && e.metaKey) { e.preventDefault(); toggle(); }
    else if (e.key === 'j') { e.preventDefault(); seekSentence(1); }
    else if (e.key === 's') { e.preventDefault(); stop(); }
  });

  // Exposed so a test can confirm which timeline the chapter used.
  window.__upscAudio = {
    source: function () { return source; },
    at: function (i) { return starts ? starts[i] : null; },
    count: function () { return starts ? starts.length : 0; },
  };
})();