/* UPSCbooks TTS reader — sentence-level playback with highlight (Web Speech API).
   When playback reaches the end of loaded content, it asks UPSC_Reader to append
   the next chapter and continues seamlessly. */
function initTTS() {
  const bar = document.getElementById('tts-bar');
  if (!bar) return;
  if (!('speechSynthesis' in window)) return;

  function getSents() {
    return Array.from(document.querySelectorAll('.tts-sent'))
      .sort((a, b) => (+a.getAttribute('data-sid')) - (+b.getAttribute('data-sid')));
  }

  const synth = window.speechSynthesis;
  const playBtn = document.getElementById('tts-play');
  const prevBtn = document.getElementById('tts-prev');
  const nextBtn = document.getElementById('tts-next');
  const stopBtn = document.getElementById('tts-stop');
  const rateIn = document.getElementById('tts-rate');
  const voiceSel = document.getElementById('tts-voice');
  const posEl = document.getElementById('tts-pos');

  if (!getSents().length) { bar.hidden = true; return; }

  let idx = Math.max(0, parseInt(bar.getAttribute('data-start') || '0', 10));
  let playing = false;
  let stopped = true;
  let voices = [];
  let lastVoice = '';
  try { lastVoice = localStorage.getItem('upscbooks-tts-voice') || ''; } catch (e) {}

  function pickVoice() {
    if (!voices.length) return null;
    return voices.find((v) => v.name === voiceSel.value) ||
      voices.find((v) => v.lang === 'en-US') || voices[0];
  }

  function loadVoices() {
    voices = synth.getVoices().filter((v) => /^en/i.test(v.lang));
    if (!voices.length) return;
    const wanted = lastVoice && voices.find((v) => v.name === lastVoice) ? lastVoice : (voices[0] && voices[0].name);
    voiceSel.innerHTML = '';
    voices.forEach((v) => {
      const o = document.createElement('option');
      o.value = v.name; o.textContent = `${v.name} (${v.lang})`;
      voiceSel.appendChild(o);
    });
    voiceSel.value = wanted || '';
    lastVoice = voiceSel.value;
  }
  if ('onvoiceschanged' in synth) synth.addEventListener('voiceschanged', loadVoices);
  loadVoices();

  function setPos() {
    if (posEl) posEl.textContent = `${idx + 1} / ${getSents().length}`;
  }
  setPos();

  function clearHighlight() {
    getSents().forEach((s) => s.classList.remove('active'));
  }
  function highlight(i) {
    clearHighlight();
    const el = getSents()[i];
    if (!el) return;
    el.classList.add('active');
    if (el.scrollIntoView) {
      const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      try { el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); } catch (e) { el.scrollIntoView(); }
    }
  }

  function speak(i) {
    stop(false);
    const sents = getSents();
    idx = Math.max(0, Math.min(sents.length - 1, i));
    highlight(idx);
    const u = new SpeechSynthesisUtterance(sents[idx].textContent);
    u.lang = 'en';
    u.rate = parseFloat(rateIn.value) || 1;
    const chosen = pickVoice();
    if (chosen) u.voice = chosen;
    u.onend = () => {
      playing = false;
      if (stopped) { setPos(); return; }
      if (idx + 1 < getSents().length) { speak(idx + 1); return; }
      // End of loaded content: ask the reader to append the next chapter,
      // then continue reading it without interruption.
      const reader = window.UPSC_Reader;
      if (reader && reader.hasNext()) {
        playBtn.textContent = '⏳';
        reader.loadNext().then((ok) => {
          if (stopped) { setPos(); return; }
          if (ok && idx + 1 < getSents().length) speak(idx + 1);
          else { stopped = true; setPos(); playBtn.textContent = '▶'; }
        });
      } else {
        stopped = true; setPos(); playBtn.textContent = '▶';
      }
    };
    u.onerror = () => {
      playing = false; stopped = true; playBtn.textContent = '▶';
    };
    stopped = false; playing = true;
    synth.speak(u);
    playBtn.textContent = '⏸';
  }

  function stop(resetIdx) {
    synth.cancel();
    playing = false; stopped = true; playBtn.textContent = '▶';
    clearHighlight();
    if (resetIdx) { idx = 0; }
  }

  playBtn.addEventListener('click', () => {
    if (playing) { synth.cancel(); stopped = true; playing = false; playBtn.textContent = '▶'; return; }
    speak(idx);
  });
  prevBtn.addEventListener('click', () => { stop(false); idx = Math.max(0, idx - 1); setPos(); highlight(idx); speak(idx); });
  nextBtn.addEventListener('click', () => { stop(false); idx = Math.min(getSents().length - 1, idx + 1); setPos(); highlight(idx); speak(idx); });
  stopBtn.addEventListener('click', () => { stop(true); setPos(); });
  rateIn.addEventListener('input', () => {
    if (playing) { const t = idx; stop(false); speak(t); }
  });
  voiceSel.addEventListener('change', () => {
    try { localStorage.setItem('upscbooks-tts-voice', voiceSel.value); } catch (e) {}
    if (playing) { const t = idx; stop(false); speak(t); }
  });

  // Click any sentence to start reading from there (delegated for appended content).
  document.addEventListener('click', (e) => {
    const s = e.target.closest && e.target.closest('.tts-sent');
    if (!s) return;
    if (document.getSelection && document.getSelection().toString()) return;
    const i = getSents().indexOf(s);
    if (i >= 0) speak(i);
  });

  window.addEventListener('beforeunload', () => { try { synth.cancel(); } catch (e) {} });

  bar.hidden = false;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTTS);
else initTTS();
