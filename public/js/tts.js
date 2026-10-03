/* =====================================================================
   UPSCbooks — text to speech

   Sentence-level playback driven by the server-rendered `.tts-sent[data-sid]`
   spans. Everything the user chooses (voice, speed, follow-along, auto-next)
   is persisted.

   Fixes over the previous implementation:
   - rate changes no longer fire on every slider pixel (presets + commit)
   - play/pause is a real pause, not cancel-and-restart
   - sentence position is restored per chapter
   - playback crosses chapter boundaries without dropping the queue
   - one <audio>-free, keyboard-operable control set with live regions
   ===================================================================== */
(function () {
  'use strict';

  var dock = document.getElementById('tts-dock');
  if (!dock) return;

  var synth = window.speechSynthesis;
  var supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  var elPlay = document.getElementById('tts-play');
  var elToggle = document.getElementById('tts-toggle');
  var elPanel = document.getElementById('tts-panel');
  var elNow = document.getElementById('tts-now');
  var elFill = document.getElementById('tts-fill');
  var elPos = document.getElementById('tts-pos');
  var elVoice = document.getElementById('tts-voice');
  var elPrev = document.getElementById('tts-prev');
  var elNext = document.getElementById('tts-next');
  var elStop = document.getElementById('tts-stop');
  var elFollow = document.getElementById('tts-autoscroll');
  var elAutoChap = document.getElementById('tts-autochap');

  var PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
  var PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><rect x="7" y="5" width="3.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="3.5" height="14" rx="1.2"/></svg>';

  /* --------------------------------------------------------- settings */
  var P = {
    voice: '',
    rate: 1,
    follow: true,
    autoChapter: true,
  };

  function loadPrefs() {
    try {
      P.voice = localStorage.getItem('upscbooks-tts-voice') || '';
      P.rate = parseFloat(localStorage.getItem('upscbooks-tts-rate')) || 1;
      P.follow = localStorage.getItem('upscbooks-tts-follow') !== '0';
      P.autoChapter = localStorage.getItem('upscbooks-tts-autochapter') !== '0';
    } catch (e) { /* private mode */ }
  }
  function savePrefs() {
    try {
      localStorage.setItem('upscbooks-tts-voice', P.voice);
      localStorage.setItem('upscbooks-tts-rate', String(P.rate));
      localStorage.setItem('upscbooks-tts-follow', P.follow ? '1' : '0');
      localStorage.setItem('upscbooks-tts-autochapter', P.autoChapter ? '1' : '0');
    } catch (e) { /* ignore */ }
  }

  function markPressed(groupSel, attr, value) {
    document.querySelectorAll(groupSel).forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute(attr) === String(value) ? 'true' : 'false');
    });
  }

  loadPrefs();

  if (!supported) {
    elNow.textContent = 'Read-aloud is not supported in this browser';
    elPlay.disabled = true;
    elToggle.disabled = true;
    dock.hidden = false;
    return;
  }

  /* ------------------------------------------------------ sentence list */
  function sentences() {
    var out = [];
    document.querySelectorAll('.tts-sent').forEach(function (el) {
      out.push(el);
    });
    out.sort(function (a, b) {
      return (+a.getAttribute('data-sid')) - (+b.getAttribute('data-sid'));
    });
    return out;
  }

  var list = sentences();
  if (!list.length) { dock.hidden = true; return; }
  dock.hidden = false;

  var storageKey = 'upscbooks-tts-pos:' + (window.UPSCBOOKS ? window.UPSCBOOKS.slug : '') +
    ':' + (window.UPSCBOOKS ? window.UPSCBOOKS.chapter : '');
  var idx = 0;
  try {
    idx = parseInt(localStorage.getItem(storageKey) || '0', 10) || 0;
  } catch (e) { /* ignore */ }
  idx = Math.max(0, Math.min(list.length - 1, idx));

  /* ------------------------------------------------------------- state */
  var voices = [];
  var playing = false;
  var paused = false;
  var advancing = false;   // an internal move to the next sentence
  var loadingChapter = false;

  /* ------------------------------------------------------------ voices */
  function englishVoices() {
    return synth.getVoices().filter(function (v) { return /^en(-|_|$)/i.test(v.lang); });
  }
  function pickVoice() {
    if (!voices.length) return null;
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].name === P.voice) return voices[i];
    }
    // Prefer a natural-sounding local English voice when nothing is chosen.
    var preferred = voices.filter(function (v) {
      return /google|natural|premium|enhanced/i.test(v.name) || v.localService === false;
    });
    return preferred[0] || voices[0];
  }
  function renderVoices() {
    if (!elVoice) return;
    elVoice.innerHTML = '';
    if (!voices.length) {
      var none = document.createElement('option');
      none.textContent = 'System default voice';
      elVoice.appendChild(none);
      return;
    }
    voices.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.name;
      o.textContent = v.name + ' (' + v.lang + ')';
      elVoice.appendChild(o);
    });
    elVoice.value = P.voice || (pickVoice() && pickVoice().name) || '';
  }
  function loadVoices() {
    var list2 = englishVoices();
    // Chrome populates voices asynchronously and fires this event.
    if (voices.length === list2.length && list2.every(function (v, i) { return voices[i] && voices[i].name === v.name; })) return;
    voices = list2;
    renderVoices();
  }
  if ('onvoiceschanged' in synth) synth.addEventListener('voiceschanged', loadVoices);
  loadVoices();
  // Some engines never fire the event; poll briefly.
  var voicePolls = 0;
  var voiceTimer = setInterval(function () {
    loadVoices();
    if (voices.length && ++voicePolls > 4) clearInterval(voiceTimer);
  }, 600);

  /* ------------------------------------------------------------- paint */
  function paint() {
    var total = list.length;
    elPos.textContent = (idx + 1) + ' / ' + total;
    elFill.style.width = (total ? ((idx / total) * 100).toFixed(1) : 0) + '%';
    elPlay.innerHTML = playing && !paused ? PAUSE_ICON : PLAY_ICON;
    elPlay.setAttribute('aria-label', playing && !paused ? 'Pause reading' : 'Resume reading');
    elPlay.setAttribute('aria-pressed', playing && !paused ? 'true' : 'false');

    var cur = list[idx];
    elNow.textContent = cur ? (cur.textContent || '').slice(0, 90) : '';

    list.forEach(function (el, i) {
      el.classList.toggle('is-active', i === idx && (playing || paused));
      if (i < idx) el.classList.add('is-done'); else el.classList.remove('is-done');
    });

    try { localStorage.setItem(storageKey, String(idx)); } catch (e) { /* ignore */ }
  }

  function scrollToCurrent() {
    if (!P.follow) return;
    var el = list[idx];
    if (!el || !el.scrollIntoView) return;
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    } catch (e) {
      el.scrollIntoView();
    }
  }

  /* ------------------------------------------------------------- speak */
  function speak(i) {
    list = sentences();
    if (!list.length) return stopAll(true);
    idx = Math.max(0, Math.min(list.length - 1, i));
    paint();
    scrollToCurrent();

    var el = list[idx];
    var text = (el.textContent || '').trim();
    if (!text) return advance();

    var u = new SpeechSynthesisUtterance(text);
    var v = pickVoice();
    if (v) u.voice = v;
    u.lang = (v && v.lang) || 'en-IN';
    u.rate = P.rate;
    u.pitch = 1;

    var token = String(idx) + ':' + (text.length);
    u.onend = function () {
      if (String(idx) + ':' + text.length !== token) return; // superseded
      if (!playing) { paint(); return; }
      advance();
    };
    u.onerror = function (ev) {
      // 'interrupted' / 'canceled' are what a deliberate cancel looks like.
      if (ev && (ev.error === 'interrupted' || ev.error === 'canceled')) return;
      elNow.textContent = 'Read-aloud stopped unexpectedly. Try again.';
      playing = false;
      paused = false;
      paint();
    };

    try {
      synth.speak(u);
    } catch (e) {
      elNow.textContent = 'Read-aloud could not start in this browser.';
      playing = false;
      paint();
      return;
    }
    playing = true;
    paused = false;
    paint();
  }

  function advance() {
    if (idx + 1 < list.length) { speak(idx + 1); return; }
    // End of the loaded content: pull in the next chapter and keep going.
    var reader = window.UPSC_Reader;
    if (!P.autoChapter || !reader || !reader.hasNext()) {
      playing = false;
      paused = false;
      elNow.textContent = 'Reached the end of what is loaded.';
      paint();
      return;
    }
    loadingChapter = true;
    elNow.textContent = 'Loading the next chapter…';
    reader.loadNext().then(function (ok) {
      loadingChapter = false;
      if (!playing) { paint(); return; }
      if (!ok) {
        playing = false;
        paused = false;
        elNow.textContent = 'End of chapter — next chapter could not load.';
        paint();
        return;
      }
      list = sentences();
      speak(idx + 1);
    });
  }

  /* ------------------------------------------------------------ actions */
  function play() {
    if (playing && !paused) {          // pause
      paused = true;
      if (synth.pause) synth.pause();
      elNow.textContent = 'Paused';
      paint();
      return;
    }
    if (paused) {                      // resume
      paused = false;
      if (synth.resume) synth.resume();
      elNow.textContent = 'Reading';
      paint();
      return;
    }
    speak(idx);
  }

  function stopAll(reset) {
    try { synth.cancel(); } catch (e) { /* ignore */ }
    playing = false;
    paused = false;
    advancing = false;
    if (reset) { idx = 0; paint(); }
  }

  function jump(delta) {
    var i = Math.max(0, Math.min(list.length - 1, idx + delta));
    stopAll(false);
    speak(i);
  }

  /* ------------------------------------------------------------- wiring */
  elPlay.addEventListener('click', play);

  elStop.addEventListener('click', function () {
    stopAll(false);
    elNow.textContent = 'Stopped';
    paint();
  });

  if (elPrev) elPrev.addEventListener('click', function () { jump(-1); });
  if (elNext) elNext.addEventListener('click', function () { jump(1); });

  elToggle.addEventListener('click', function () {
    var open = dock.classList.toggle('is-open');
    dock.classList.remove('is-min');
    elToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) elToggle.focus();
  });

  if (elVoice) {
    elVoice.addEventListener('change', function () {
      P.voice = elVoice.value;
      savePrefs();
      if (playing) { var i = idx; stopAll(false); speak(i); }
    });
  }

  document.querySelectorAll('[data-rate]').forEach(function (b) {
    b.addEventListener('click', function () {
      P.rate = parseFloat(b.getAttribute('data-rate')) || 1;
      markPressed('[data-rate]', 'data-rate', P.rate);
      savePrefs();
      if (playing) { var i = idx; stopAll(false); speak(i); }
    });
  });
  markPressed('[data-rate]', 'data-rate', P.rate);

  document.querySelectorAll('[data-scale]').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = parseFloat(b.getAttribute('data-scale'));
      markPressed('[data-scale]', 'data-scale', v);
      if (window.UPSC_Reader && window.UPSC_Reader.setScale) window.UPSC_Reader.setScale(v);
    });
  });

  function wireSwitch(btn, key) {
    if (!btn) return;
    btn.setAttribute('aria-pressed', P[key] ? 'true' : 'false');
    btn.addEventListener('click', function () {
      P[key] = !P[key];
      btn.setAttribute('aria-pressed', P[key] ? 'true' : 'false');
      savePrefs();
    });
  }
  wireSwitch(elFollow, 'follow');
  wireSwitch(elAutoChap, 'autoChapter');

  // Tap any sentence to read from that point.
  document.addEventListener('click', function (e) {
    var s = e.target.closest ? e.target.closest('.tts-sent') : null;
    if (!s) return;
    if (window.getSelection && String(window.getSelection())) return;
    var i = list.indexOf(s);
    if (i < 0) { list = sentences(); i = list.indexOf(s); }
    if (i < 0) return;
    stopAll(false);
    speak(i);
  });

  /* --------------------------------------------------- keyboard support */
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (typing) return;

    if (e.key === ' ' || e.key === 'k' && e.metaKey) {
      e.preventDefault();
      play();
      return;
    }
    if (e.key === 'j' || e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); jump(1); return; }
    if (e.key === 'k') { e.preventDefault(); jump(-1); return; }
    if (e.key === 't') { e.preventDefault(); elToggle.click(); return; }
    if (e.key === 's') { e.preventDefault(); stopAll(false); paint(); return; }
  });

  /* ------------------------------------------------------- housekeeping */
  window.addEventListener('beforeunload', function () {
    try { synth.cancel(); } catch (e) { /* ignore */ }
  });
  document.addEventListener('visibilitychange', function () {
    // A backgrounded tab is not studying — don't keep talking.
    if (document.hidden && playing && !paused) {
      paused = true;
      if (synth.pause) synth.pause();
      paint();
    }
  });

  // If the engine gets wedged, don't strand the dock in a playing state.
  var watchdog = setInterval(function () {
    if (playing && !paused && !synth.speaking && !loadingChapter) {
      var el = list[idx];
      if (el) { el.classList.remove('is-active'); }
    }
  }, 1500);

  elNow.textContent = 'Tap play, or tap any sentence to read from there';
  paint();
})();