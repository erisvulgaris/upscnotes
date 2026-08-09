// Reader content renderer.
// Converts a chapter's stored `sections` JSON (blocks: para|subhead|note|table|image|alert)
// into HTML that re-uses the reader client (app.js / tts.js / reader.js),
// generating `.tts-sent[data-sid]` spans server-side with Intl.Segmenter
// (mirrors the segmenter logic in polity/build-polity.mjs).
import { esc } from './esc.js';

const SEGMENTER = new Intl.Segmenter('en', { granularity: 'sentence' });
let sidCounter = 0;
function resetSid() { sidCounter = 0; }
function nextSid() { return sidCounter++; }

function runsHtml(runs) {
  if (!runs) return '';
  let out = '';
  for (const r of runs) {
    let t = esc(r.text || '');
    if (r.bold && r.italic) t = `<b><i>${t}</i></b>`;
    else if (r.bold) t = `<b>${t}</b>`;
    else if (r.italic) t = `<i>${t}</i>`;
    out += t;
  }
  return out;
}

function runsSentences(runs) {
  if (!runs || !runs.length) return `<span class="tts-sent" data-sid="${nextSid()}">​</span>`;
  const bounds = [];
  let text = '';
  for (const r of runs) {
    bounds.push({ start: text.length, end: text.length + (r.text || '').length, r });
    text += (r.text || '');
  }
  const segs = Array.from(SEGMENTER.segment(text)).filter((s) => s.segment.trim());
  if (!segs.length) return `<span class="tts-sent" data-sid="${nextSid()}">${runsHtml(runs)}</span>`;

  const out = [];
  for (const seg of segs) {
    const s = seg.index, e = seg.index + seg.segment.length;
    let inner = '';
    for (const b of bounds) {
      const bS = Math.max(s, b.start), bE = Math.min(e, b.end);
      if (bS >= bE) continue;
      let t = b.r.text.slice(bS - b.start, bE - b.start);
      t = esc(t);
      if (b.r.bold && b.r.italic) t = `<b><i>${t}</i></b>`;
      else if (b.r.bold) t = `<b>${t}</b>`;
      else if (b.r.italic) t = `<i>${t}</i>`;
      inner += t;
    }
    out.push(`<span class="tts-sent" data-sid="${nextSid()}">${inner}</span>`);
  }
  return out.join('');
}

function blockHtml(b, ctx) {
  switch (b.kind) {
    case 'para':
      return `<p class="rd-para">${runsSentences(b.runs)}</p>`;
    case 'subhead':
      return `<h3 class="rd-subhead">${runsHtml(b.runs)}</h3>`;
    case 'note':
      return `<div class="rd-note"><span class="rd-note-t">${runsHtml(b.runs)}</span></div>`;
    case 'alert':
      return `<div class="rd-alert rd-alert-${b.variant || 'note'}">${runsHtml(b.runs)}</div>`;
    case 'table':
      return tableHtml(b);
    case 'image':
      return imageHtml(b, ctx);
    default:
      return `<p class="rd-para">${runsSentences(b.runs)}</p>`;
  }
}

function tableHtml(b) {
  const rows = (b.rows || []).map(
    (tr) => `<tr>${(tr.cells || []).map((c) => `<${c.th ? 'th' : 'td'}>` + runsHtml(c.runs) + `</${c.th ? 'th' : 'td'}>`).join('')}</tr>`
  ).join('');
  const head = b.head
    ? `<thead><tr>${b.head.cells.map((c) => `<th>${runsHtml(c.runs)}</th>`).join('')}</tr></thead>`
    : '';
  const cls = b.wide ? ' rd-table-wide' : '';
  return `<div class="rd-tablewrap"><table class="rd-table${cls}"><tbody>${head}${rows}</tbody></table></div>`;
}

function imageHtml(b, ctx) {
  let src = b.src || b.image;
  // Normalize authored paths ("/c2/mih/..." or "images/...") into a content-relative
  // slug path served by the /content route.
  let normalized = '';
  if (src) {
    normalized = src.replace(/^\/c2\/[^/]+\//, '').replace(/^\.\.\//, '');
    if (!ctx) normalized = '';
  }
  const href = normalized && ctx ? `/content/${ctx.book}/${normalized}` : '';
  const cap = runsHtml(b['caption_runs'] || b.caption_runs || []);
  const wide = b.wide ? ' rd-figure-wide' : '';
  const img = href
    ? `<img src="${esc(href)}" alt="${esc(cap)}" loading="lazy">`
    : `<span class="rd-figcaption-placeholder">[image]</span>`;
  return `<figure class="rd-figure${wide}">${img}<figcaption>${cap}</figcaption></figure>`;
}

export function renderSection(sec, ctx) {
  return (sec.blocks || []).map((b) => blockHtml(b, ctx)).join('');
}

export function renderChapter(sections, ctx) {
  resetSid();
  let out = '';
  for (const sec of (sections || [])) {
    const sid = sec.id || sec.num;
    out += `<section class="sectitle-anchor" id="sec-${sid}">`;
    out += `<h3 class="rd-sectitle"><span class="muted">${esc(sec.num ?? '')}</span> ${esc(sec.title || '')}</h3>`;
    out += (sec.blocks || []).map((b) => blockHtml(b, ctx)).join('');
    out += `</section>`;
  }
  return out;
}

export function sentenceCount(sections) {
  let n = 0;
  for (const sec of (sections || [])) {
    for (const b of (sec.blocks || [])) {
      if (b.kind === 'para' && b.runs && b.runs.some((r) => (r.text || '').trim())) n += 1;
    }
  }
  return n;
}
