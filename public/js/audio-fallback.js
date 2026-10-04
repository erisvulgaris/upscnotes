/* =====================================================================
   UPSCbooks — audio fallback

   Preferred path is the device's own speech engine (tts.js): it is
   free, offline, and lets the reader re-time a chapter instantly. Where it
   is missing or silent — older WebKit, some in-app browsers, locked-down
   enterprise builds, no installed voices — we fall back to the
   pre-rendered Edge TTS audio stored as 16 kHz Opus on Cloudflare R2.

   This file owns nothing but the fallback: it registers itself with tts.js
   and stays dormant when speech synthesis works.
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
  var timings = null;      // [{ t, text }]
  var sentences = [];      // .tts-sent elements, ordered by data-sid
  var idx = -1;
  var mode = 'idle';       // idle | loading | playing | paused
  var seeking = false;
  // Zeroing currentTime fires a timeupdate, which would immediately re-light
  // sentence 0 over the reset. Ignore sync callbacks until we are playing again.
  var suppressed = false;

  var PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
  var PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><rect x="7" y="5" width="3.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="3.5" height="14" rx="1.2"/></svg>';
  var LOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" width="20" height="20" aria-hidden="true"><path d="M12 3v4M12 17v4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M3 12h4M17 12h4M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>';

  function orderedSentences() {
    var out = [];
    document.querySelectorAll('.tts-sent').forEach(function (el) { out.push(el); });
    out.sort(function (a, b) {
      return (+a.getAttribute('data-sid')) - (+b.getAttribute('data-sid'));
    });
    return out;
  }

  function paint(position) {
    if (!timings || !timings.length) return;
    posEl.textContent = (idx + 1) + ' / ' + sentences.length;
    fillEl.style.width = (idx < 0 ? 0 : (idx / sentences.length) * 100).toFixed(1) + '%';
    sentences.forEach(function (el, i) {
      el.classList.toggle('is-active', i === idx);
      if (i < idx) el.classList.add('is-done'); else el.classList.remove('is-done');
    });
    if (idx >= 0 && sentences[idx] && document.getElementById('tts-follow')) {
      var el2 = sentences[idx];
      if (document.getElementById('tts-follow').getAttribute('aria-pressed') !== 'false') {
        var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        try {
          el2.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
        } catch (e) { el2.scrollIntoView(); }
      }
    }
    if (nowEl) {
      var el3 = sentences[idx];
      nowEl.textContent = el3 ? (el3.textContent || '').slice(0, 90) : '';
    }
  }

  function setButton(icon) {
    if (playBtn) playBtn.innerHTML = icon;
  }

  /** Nearest sentence whose start time is at or before `t`. */
  function sentenceAt(t) {
    if (!timings) return -1;
    var lo = 0, hi = timings.length - 1, best = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (timings[mid].t <= t) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return best;
  }

  function load() {
    if (mode === 'loading' || mode === 'playing' || mode === 'paused') return Promise.resolve();
    mode = 'loading';
    setButton(LOAD_ICON);
    if (nowEl) nowEl.textContent = 'Loading narration';

    var base = '/audio/' + encodeURIComponent(slug) + '/' + encodeURIComponent(chapter);
    return fetch(base + '.json', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('no-audio'); return r.json(); })
      .then(function (data) {
        timings = data.sentenceTimings || [];
        sentences = orderedSentences();
        audio = new Audio(data.url);
        // "metadata", not "auto": the heaviest chapter is 49MB of Opus, and
        // preloading all of it would pull the entire file before the reader
        // hears a word. With Range support the browser streams on demand and
        // seeking still works.
        audio.preload = 'metadata';
        audio.crossOrigin = 'anonymous';

        audio.addEventListener('timeupdate', function () {
          if (seeking || suppressed) return;
          var i = sentenceAt(audio.currentTime);
          if (i !== idx) { idx = i; paint(); }
        });
        audio.addEventListener('loadedmetadata', function () {
          if (audio.duration && isFinite(audio.duration)) { /* known duration */ }
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
          playBtn.setAttribute('aria-label', 'Pause narration');
        });
      })
      .catch(function () {
        mode = 'idle';
        setButton(PLAY_ICON);
        if (nowEl) nowEl.textContent = 'No narration for this chapter';
      });
  }

  function toggle() {
    if (!audio) return load();
    if (audio.paused) {
      suppressed = false;
      audio.play().then(function () {
        mode = 'playing';
        setButton(PAUSE_ICON);
      }).catch(function () { /* keep paused */ });
    } else {
      audio.pause();
      mode = 'paused';
      setButton(PLAY_ICON);
    }
  }

  function seekSentence(delta) {
    if (!audio || !timings || !timings.length) return;
    var target = Math.max(0, Math.min(timings.length - 1, idx + delta));
    seeking = true;
    suppressed = false;
    audio.currentTime = timings[target].t;
    idx = target;
    paint();
    setTimeout(function () { seeking = false; }, 120);
  }

  function stop() {
    // Suppress timeupdate across the reset: assigning currentTime fires one,
    // and it would light sentence 0 straight back up.
    suppressed = true;
    if (audio) { audio.pause(); audio.currentTime = 0; }
    idx = -1;
    mode = 'idle';
    setButton(PLAY_ICON);
    paint();
    if (nowEl) nowEl.textContent = 'Stopped';
  }

  /* ------------------------------------------------------------ wiring */

  function attach() {
    if (!dock) return;
    dock.hidden = false;
    if (playBtn) {
      // Intercept before the Web Speech handler by capturing on the element.
      playBtn.addEventListener('click', function (e) {
        e.stopImmediatePropagation();
        toggle();
      }, true);
    }
    if (prevBtn) prevBtn.addEventListener('click', function (e) { e.stopImmediatePropagation(); seekSentence(-1); }, true);
    if (nextBtn) nextBtn.addEventListener('click', function (e) { e.stopImmediatePropagation(); seekSentence(1); }, true);
    if (stopBtn) stopBtn.addEventListener('click', function (e) { e.stopImmediatePropagation(); stop(); }, true);

    // The options panel belongs to the Web Speech engine; hide its voice
    // controls so the fallback does not offer a picker it cannot honour.
    var voiceRow = document.querySelector('#tts-voice') && document.querySelector('#tts-voice').closest('.tts-panel-row');
    if (voiceRow) voiceRow.hidden = true;
    var rateRow = document.querySelector('[data-rate]') && document.querySelector('[data-rate]').closest('.tts-panel-row');
    if (rateRow) rateRow.hidden = true;
    var followRow = document.getElementById('tts-autoscroll');
    if (followRow) followRow.setAttribute('aria-pressed', 'true');

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

  /* -------------------------------------------------- activation logic */

  function webSpeechUsable() {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return false;
    // A synthesis object with zero voices means nothing can actually speak.
    try { return window.speechSynthesis.getVoices().length > 0; } catch (e) { return false; }
  }

  // getVoices() is async on some engines, so re-check once they land.
  function decide() {
    if (webSpeechUsable()) return;      // tts.js keeps control
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
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
    else if (e.key === 'j') { e.preventDefault(); seekSentence(1); }
    else if (e.key === 's') { e.preventDefault(); stop(); }
  });
})();