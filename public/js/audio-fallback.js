/* =====================================================================
   upscnotes — audio player (recorded narration primary, Web Speech fallback)

   Preferred path is the device's own recorded narration streamed from R2: it
   is consistent, accurate, and drives a real seek bar, speed control, volume,
   ±10 s skip, and chapter navigation.

   This file takes over when recorded audio is available, and falls back to the
   Web Speech engine only when the browser has no usable voice or the chapter
   has no narration. It then streams the pre-rendered 16 kHz Opus from
   audio/<slug>/<chapter>.opus.

   The hard part is the highlight. The cached sidecars were generated from
   narrationText()'s chunking, which includes section titles, table cells and
   captions that the reader never highlights, so sidecar index i is NOT the
   i-th highlighted sentence. audio/<slug>/<chapter>.sync.json is the corrected
   timeline, built by tools/tts/fix-sync.mjs by locating each highlighted
   sentence inside the spoken stream. It is used when present. If it is missing,
   the same alignment is computed here in the browser from the DOM and the
   sidecar, so a chapter without an index still highlights correctly rather
   than drifting.
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
  var prevChBtn = document.getElementById('tts-prev-ch');
  var prevBtn = document.getElementById('tts-prev');
  var nextBtn = document.getElementById('tts-next');
  var nextChBtn = document.getElementById('tts-next-ch');
  var nowEl = document.getElementById('tts-now');
  var curEl = document.getElementById('tts-cur');
  var durEl = document.getElementById('tts-dur');
  var seekEl = document.getElementById('tts-seek');
  var posEl = document.getElementById('tts-pos');
  var muteBtn = document.getElementById('tts-mute');
  var stopBtn = document.getElementById('tts-stop');
  var panelBtn = document.getElementById('tts-toggle');
  var elFollow = document.getElementById('tts-autoscroll');
  var elAutoChap = document.getElementById('tts-autochap');
  var elVoice = document.getElementById('tts-voice');
  var elRates = document.querySelectorAll('[data-rate]');

  var audio = null;
  var starts = null;
  var sentences = [];
  var idx = -1;
  var mode = 'idle';
  var seeking = false;
  var suppressed = false;
  var saveTimer = null;
  var hasRecorded = false;
  var pendingSeek = null;

  var PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
  var PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><rect x="7" y="5" width="3.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="3.5" height="14" rx="1.2"/></svg>';
  var LOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" width="20" height="20" aria-hidden="true"><path d="M12 3v4M12 17v4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M3 12h4M17 12h4M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>';
  var VOL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7"/></svg>';
  var MUTE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';

  var CHAPTER_SKIP = 10;
  var SAVE_INTERVAL = 2000;
  var META_TTL = 60000;

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
    out.sort(function (a, b) { return (+a.getAttribute('data-sid')) - (+b.getAttribute('data-sid')); });
    return out;
  }

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

  function sentenceAt(t) {
    if (!starts || !starts.length) return -1;
    var lo = 0, hi = starts.length - 1, best = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (starts[mid] <= t) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return best;
  }

  /* --------------------------------------------------------------- paint */

  function paint() {
    if (!starts || !starts.length) return;
    var total = sentences.length;
    posEl.textContent = (idx + 1) + ' / ' + total;
    sentences.forEach(function (el, i) {
      el.classList.toggle('is-active', i === idx);
      if (i < idx) el.classList.add('is-done'); else el.classList.remove('is-done');
    });
    var cur = sentences[idx];
    if (cur && nowEl) nowEl.textContent = (cur.textContent || '').slice(0, 90);

    var follow = elFollow;
    if (cur && follow && follow.getAttribute('aria-pressed') !== 'false' &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      try { cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { cur.scrollIntoView(); }
    }
  }

  function formatTime(s) {
    if (!Number.isFinite(s) || s < 0) s = 0;
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function setButton(icon) {
    if (playBtn) playBtn.innerHTML = icon;
  }

  function setMuteIcon(muted) {
    if (muteBtn) muteBtn.innerHTML = muted ? MUTE_ICON : VOL_ICON;
    if (muteBtn) muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  }

  /* ----------------------------------------------------------- progress API */

  function getProgress() {
    try {
      var stored = localStorage.getItem('upscnotes-tts-pos:' + slug + ':' + chapter);
      return stored ? JSON.parse(stored) : {};
    } catch (e) { return {}; }
  }
  function saveProgress(pos) {
    try {
      var p = getProgress();
      if (pos) Object.assign(p, pos);
      localStorage.setItem('upscnotes-tts-pos:' + slug + ':' + chapter, JSON.stringify(p));
    } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------- load + play */

  function loadRecorded(side) {
    if (mode !== 'idle') return Promise.resolve();
    mode = 'loading';
    setButton(LOAD_ICON);
    if (nowEl) nowEl.textContent = 'Loading narration';

    var base = '/audio/' + encodeURIComponent(slug) + '/' + encodeURIComponent(chapter);

    return Promise.all([
      fetch(base + '.sync.json', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(base + '.json', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    ]).then(function (both) {
      var sync = both[0];
      var timings = both[1];
      sentences = orderedSentences();
      if (!sentences.length) { setButton(PLAY_ICON); return; }

      if (sync && Array.isArray(sync.starts) && sync.starts.length === sentences.length) {
        starts = sync.starts;
      } else if (timings && Array.isArray(timings.sentenceTimings) && timings.sentenceTimings.length) {
        var r = alignLocally(timings.sentenceTimings, timings.duration || 0);
        starts = r.starts;
      } else {
        setButton(PLAY_ICON);
        if (nowEl) nowEl.textContent = 'No narration for this chapter';
        return;
      }

      var url = (timings && timings.url) || (base + '.opus');
      audio = new Audio(url);
      audio.preload = 'metadata';
      audio.volume = 1;

      if (pendingSeek) {
        audio.currentTime = pendingSeek;
        pendingSeek = null;
      }

      audio.addEventListener('timeupdate', function () {
        if (seeking) return;
        var t = audio.currentTime;
        if (curEl) curEl.textContent = formatTime(t);
        if (seekEl && !seeking) {
          if (audio.duration && Number.isFinite(audio.duration)) {
            seekEl.value = Math.round((t / audio.duration) * 1000);
          }
        }
        var i = sentenceAt(t);
        if (i !== idx) { idx = i; paint(); }
        saveProgress({ audioMs: Math.round(t * 1000), scrollPct: 0 });
      });
      audio.addEventListener('loadedmetadata', function () {
        if (durEl && audio.duration) durEl.textContent = formatTime(audio.duration);
        var p = getProgress();
        if (p.audioMs && audio.duration && p.audioMs / 1000 < audio.duration - 2) {
          audio.currentTime = p.audioMs / 1000;
        }
        if (seekEl && audio.duration) seekEl.value = Math.round((audio.currentTime / audio.duration) * 1000);
      });
      audio.addEventListener('ended', function () {
        mode = 'idle';
        setButton(PLAY_ICON);
        if (nowEl) nowEl.textContent = 'End of narration';
        saveProgress({ completed: 1 });
        if (autoNextChapter()) advanceChapter();
      });
      audio.addEventListener('error', function () {
        mode = 'idle';
        setButton(PLAY_ICON);
        if (nowEl) nowEl.textContent = 'Narration failed to load';
      });

      return audio.play().then(function () {
        mode = 'playing';
        setButton(PAUSE_ICON);
        if (playBtn) playBtn.setAttribute('aria-label', 'Pause');
        startSaveLoop();
      }).catch(function () { /* keep paused */ });
    }).catch(function () {
      mode = 'idle';
      setButton(PLAY_ICON);
      if (nowEl) nowEl.textContent = 'Narration could not be loaded';
    });
  }

  function toggle() {
    if (!audio) return loadRecorded();
    if (audio.paused) {
      suppressed = false;
      audio.play().then(function () {
        mode = 'playing';
        setButton(PAUSE_ICON);
        if (playBtn) playBtn.setAttribute('aria-label', 'Pause');
        startSaveLoop();
      }).catch(function () { /* keep paused */ });
    } else {
      audio.pause();
      mode = 'paused';
      setButton(PLAY_ICON);
      if (playBtn) playBtn.setAttribute('aria-label', 'Resume');
    }
  }

  function seekBy(delta) {
    if (!audio || !audio.duration) return;
    var t = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));
    audio.currentTime = t;
    if (seekEl) seekEl.value = Math.round((t / audio.duration) * 1000);
  }

  function stop() {
    suppressed = true;
    if (audio) { audio.pause(); audio.currentTime = 0; }
    idx = -1;
    mode = 'idle';
    setButton(PLAY_ICON);
    if (playBtn) playBtn.setAttribute('aria-label', 'Play');
    paint();
    if (nowEl) nowEl.textContent = 'Stopped';
    if (seekEl) seekEl.value = 0;
    if (curEl) curEl.textContent = '0:00';
    saveProgress({ audioMs: 0 });
  }

  function advanceChapter() {
    var reader = window.UPSC_Reader;
    if (!reader || !reader.hasNext()) return;
    loadingChapter = true;
    if (nowEl) nowEl.textContent = 'Loading the next chapter\u2026';
    reader.loadNext().then(function (ok) {
      loadingChapter = false;
      if (!ok) {
        if (nowEl) nowEl.textContent = 'End of chapter \u2014 next chapter could not load.';
        return;
      }
      pendingSeek = 0;
      loadRecorded();
    });
  }

  var loadingChapter = false;

  function autoNextChapter() {
    return elAutoChap && elAutoChap.getAttribute('aria-pressed') !== 'false';
  }

  function startSaveLoop() {
    if (saveTimer) clearInterval(saveTimer);
    saveTimer = setInterval(function () {
      if (!audio || audio.paused) { clearInterval(saveTimer); saveTimer = null; return; }
      saveProgress({ audioMs: Math.round(audio.currentTime * 1000) });
    }, SAVE_INTERVAL);
  }

  /* ------------------------------------------------------------ wiring */

  function attach() {
    if (!dock) return;
    dock.hidden = false;
    if (playBtn) playBtn.addEventListener('click', function (e) { e.stopImmediatePropagation(); toggle(); }, true);
    if (prevBtn) prevBtn.addEventListener('click', function (e) { e.stopImmediatePropagation(); seekBy(-CHAPTER_SKIP); }, true);
    if (nextBtn) nextBtn.addEventListener('click', function (e) { e.stopImmediatePropagation(); seekBy(CHAPTER_SKIP); }, true);
    if (prevChBtn) prevChBtn.addEventListener('click', function (e) {
      e.stopImmediatePropagation();
      var reader = window.UPSC_Reader;
      if (reader && reader.prev) { stop(); reader.prev(); pendingSeek = 0; }
    }, true);
    if (nextChBtn) nextChBtn.addEventListener('click', function (e) {
      e.stopImmediatePropagation();
      if (autoNextChapter() && audio && !audio.ended) { advanceChapter(); return; }
      var reader = window.UPSC_Reader;
      if (reader && reader.next) { stop(); reader.next(); pendingSeek = 0; }
    }, true);
    if (stopBtn) stopBtn.addEventListener('click', function (e) { e.stopImmediatePropagation(); stop(); }, true);
    if (muteBtn) muteBtn.addEventListener('click', function (e) {
      e.stopImmediatePropagation();
      if (!audio) return;
      audio.muted = !audio.muted;
      setMuteIcon(audio.muted);
    }, true);
    if (seekEl) {
      seekEl.addEventListener('input', function () {
        seeking = true;
        if (audio && audio.duration) {
          var t = (Number(seekEl.value) / 1000) * audio.duration;
          audio.currentTime = t;
          if (curEl) curEl.textContent = formatTime(t);
        }
      });
      seekEl.addEventListener('change', function () {
        seeking = false;
        if (audio && audio.duration) {
          var t = (Number(seekEl.value) / 1000) * audio.duration;
          audio.currentTime = t;
        }
      });
    }

    // Speed presets.
    elRates.forEach(function (b) {
      b.addEventListener('click', function () {
        var rate = parseFloat(b.getAttribute('data-rate')) || 1;
        if (audio) audio.playbackRate = rate;
        elRates.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        try { localStorage.setItem('upscnotes-tts-rate', String(rate)); } catch (e) { /* ignore */ }
      });
    });
    try {
      var savedRate = parseFloat(localStorage.getItem('upscnotes-tts-rate')) || 1;
      if (audio) audio.playbackRate = savedRate;
      elRates.forEach(function (x) {
        x.setAttribute('aria-pressed', parseFloat(x.getAttribute('data-rate')) === savedRate ? 'true' : 'false');
      });
    } catch (e) { /* ignore */ }

    // Follow + autochap switches.
    if (elFollow) elFollow.setAttribute('aria-pressed', 'true');
    if (elAutoChap) elAutoChap.setAttribute('aria-pressed', 'true');

    var sr = document.getElementById('tts-sr');
    if (!sr) {
      sr = document.createElement('p');
      sr.id = 'tts-sr';
      sr.className = 'sr-only';
      sr.setAttribute('role', 'status');
      sr.setAttribute('aria-live', 'polite');
      dock.appendChild(sr);
    }
    sr.textContent = 'Playing recorded narration.';
    setMuteIcon(false);
    setButton(PLAY_ICON);
    if (nowEl) nowEl.textContent = 'Ready';
    if (durEl) durEl.textContent = '0:00';
    if (curEl) curEl.textContent = '0:00';
    if (seekEl) seekEl.value = 0;
  }

  /* ------------------------------------------------------- fallback path */

  function webSpeechUsable() {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return false;
    try { return window.speechSynthesis.getVoices().length > 0; } catch (e) { return false; }
  }

  function loadWebSpeech() {
    if (mode !== 'idle') return;
    mode = 'loading';
    setButton(LOAD_ICON);
    if (nowEl) nowEl.textContent = 'Using system voice\u2026';
    sentences = orderedSentences();
    if (!sentences.length) { setButton(PLAY_ICON); return; }
    starts = new Array(sentences.length).fill(0);
    if (durEl) durEl.textContent = '\u2014';
    if (sr) sr.textContent = 'Using system voice. Recorded audio is not available for this chapter.';
    if (nowEl) nowEl.textContent = 'Tap play, or tap any sentence to read from there';
    setButton(PLAY_ICON);
  }

  var sr = document.getElementById('tts-sr');

  function decide() {
    // Recorded audio is always preferred when present.
    // fetch metadata first to confirm existence without buffering the whole file.
    var base = '/audio/' + encodeURIComponent(slug) + '/' + encodeURIComponent(chapter);
    fetch(base + '.json', { credentials: 'same-origin' }).then(function (r) {
      if (r.ok) {
        hasRecorded = true;
        attach();
        return;
      }
      // No sidecar: try the media itself. HEAD is enough to know if it exists.
      return fetch(base + '.opus', { method: 'HEAD', credentials: 'same-origin' }).then(function (r2) {
        if (r2.ok || r2.status === 206) { hasRecorded = true; attach(); }
        else loadWebSpeech();
      }).catch(function () { loadWebSpeech(); });
    }).catch(function () { loadWebSpeech(); });
  }

  /* --------------------------------------------------- keyboard support */

  document.addEventListener('keydown', function (e) {
    if (!audio && !hasRecorded) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === ' ' || e.key === 'k' && e.metaKey) { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight' && e.altKey) { e.preventDefault(); seekBy(CHAPTER_SKIP); }
    else if (e.key === 'ArrowLeft' && e.altKey) { e.preventDefault(); seekBy(-CHAPTER_SKIP); }
    else if (e.key === 'j') { e.preventDefault(); seekBy(CHAPTER_SKIP); }
    else if (e.key === 'k') { e.preventDefault(); seekBy(-CHAPTER_SKIP); }
    else if (e.key === 't') { e.preventDefault(); panelBtn && panelBtn.click(); }
    else if (e.key === 's') { e.preventDefault(); stop(); }
  });

  /* ------------------------------------------------------- housekeeping */

  window.addEventListener('beforeunload', function () {
    if (audio) { try { audio.pause(); } catch (e) { /* ignore */ } saveProgress({ audioMs: Math.round((audio && audio.currentTime) * 1000) }); }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && audio && !audio.paused) {
      saveProgress({ audioMs: Math.round(audio.currentTime * 1000) });
    }
  });

  decide();
})();
