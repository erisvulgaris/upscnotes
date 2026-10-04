// Reader content renderer.
// Converts a chapter's stored `sections` JSON (blocks: para|subhead|note|table|image|alert)
// into HTML that re-uses the reader client (app.js / tts.js / reader.js),
// generating `.tts-sent[data-sid]` spans server-side with Intl.Segmenter
// (mirrors the segmenter logic in polity/build-polity.mjs).
import { esc } from './esc.js';

const SEGMENTER = new Intl.Segmenter('en', { granularity: 'sentence' });

// Sentence ids are scoped per render (per HTTP request) via the render ctx,
// never module-global — concurrent renders must not share a counter.
function nextSid(ctx) {
  ctx.sid = ctx.sid || { n: 0 };
  return ctx.sid.n++;
}

function runsText(runs) {
  if (!runs) return '';
  let out = '';
  for (const r of runs) out += (r.text || '');
  return out;
}

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

function runsSentences(runs, ctx) {
  if (!runs || !runs.length) return `<span class="tts-sent" data-sid="${nextSid(ctx)}">​</span>`;
  const bounds = [];
  let text = '';
  for (const r of runs) {
    bounds.push({ start: text.length, end: text.length + (r.text || '').length, r });
    text += (r.text || '');
  }
  const segs = Array.from(SEGMENTER.segment(text)).filter((s) => s.segment.trim());
  if (!segs.length) return `<span class="tts-sent" data-sid="${nextSid(ctx)}">${runsHtml(runs)}</span>`;

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
    out.push(`<span class="tts-sent" data-sid="${nextSid(ctx)}">${inner}</span>`);
  }
  return out.join('');
}

function blockHtml(b, ctx) {
  switch (b.kind) {
    case 'para':
      return `<p class="rd-para">${runsSentences(b.runs, ctx)}</p>`;
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
      return `<p class="rd-para">${runsSentences(b.runs, ctx)}</p>`;
  }
}

function tableHtml(b) {
  // Accept both the canonical {cells:[{runs,th}]} shape and the legacy stored
  // shape where each row is an array of cells and each cell is {paras:[{runs}]}.
  function cellRuns(c) {
    if (!c) return [];
    if (c.runs) return c.runs;
    if (Array.isArray(c.paras)) {
      const out = [];
      for (const p of c.paras) {
        for (const r of (p.runs || [])) out.push(r);
        if (out.length && out[out.length - 1].text) {
          out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text + '\n' };
        }
      }
      return out;
    }
    return [];
  }
  function cellHtml(c) {
    const isTh = !!(c && (c.th || c.header));
    return `<${isTh ? 'th' : 'td'}>${runsHtml(cellRuns(c))}</${isTh ? 'th' : 'td'}>`;
  }
  function rowHtml(tr) {
    if (Array.isArray(tr)) return `<tr>${tr.map(cellHtml).join('')}</tr>`;
    return `<tr>${(tr.cells || []).map(cellHtml).join('')}</tr>`;
  }
  const rows = (b.rows || []).map(rowHtml).join('');
  const head = b.head
    ? `<thead><tr>${(b.head.cells || []).map(cellHtml).join('')}</tr></thead>`
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
  const capHtml = runsHtml(b['caption_runs'] || b.caption_runs || []);
  const capText = runsText(b['caption_runs'] || b.caption_runs || []);
  const wide = b.wide ? ' rd-figure-wide' : '';
  const img = href
    ? `<img src="${esc(href)}" alt="${esc(capText)}" loading="lazy">`
    : `<span class="rd-figcaption-placeholder">[image]</span>`;
  return `<figure class="rd-figure${wide}">${img}<figcaption>${capHtml}</figcaption></figure>`;
}

export function renderSection(sec, ctx) {
  return (sec.blocks || []).map((b) => blockHtml(b, ctx)).join('');
}

export function renderChapter(sections, ctx) {
  ctx.sid = { n: 0 };
  let out = '';
  for (const sec of (sections || [])) {
    const sid = sec.id || sec.num;
    // Some stored sections carry num: 0 or an empty string. Rendering that
    // produced a literal "0" in front of the heading ("0 Start").
    const num = (sec.num === 0 || sec.num === '' || sec.num == null) ? '' : sec.num;
    out += `<section class="sectitle-anchor" id="sec-${sid}">`;
    out += `<h3 class="rd-sectitle">${num ? `<span class="muted">${esc(num)}</span> ` : ''}${esc(sec.title || '')}</h3>`;
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

// ---------------------------------------------------------------------------
// Narration source.
//
// The audiobook must say exactly what the reader shows, and nothing else. A
// naive walk over the stored JSON also picks up structural keys, which had the
// synthesiser reading out "sec-1 Content subhead Chapter 1 para" before the
// actual sentence. This mirrors renderChapter block by block instead.

// Both the canonical {cells:[{runs,th}]} row shape and the legacy stored shape
// where a row is an array of cells and each cell is {paras:[{runs}]}.
function cellRuns(c) {
  if (!c) return [];
  if (c.runs) return c.runs;
  if (Array.isArray(c.paras)) {
    const out = [];
    for (const p of c.paras) {
      for (const r of (p.runs || [])) out.push(r);
    }
    return out;
  }
  return [];
}

function tableText(b) {
  const out = [];
  const pushCells = (cells) => {
    for (const c of (cells || [])) {
      const t = runsText(cellRuns(c));
      if (t.trim()) out.push(t.trim());
    }
  };
  if (b.head) pushCells(b.head.cells);
  for (const tr of (b.rows || [])) {
    if (Array.isArray(tr)) pushCells(tr);
    else pushCells(tr && tr.cells);
  }
  return out.join('. ');
}

// Returns readable prose for a chapter, in reading order.
export function narrationText(sections) {
  const out = [];
  for (const sec of (sections || [])) {
    const title = (sec.title || '').trim();
    if (title) out.push(title);

    for (const b of (sec.blocks || [])) {
      switch (b.kind) {
        case 'para':
        case 'subhead':
        case 'note':
        case 'alert': {
          const t = runsText(b.runs).trim();
          if (t) out.push(t);
          break;
        }
        case 'table': {
          const t = tableText(b);
          if (t) out.push(t);
          break;
        }
        case 'image': {
          // Read the caption, never the src or the alt placeholder.
          const cap = runsText(b.caption_runs || b['caption_runs'] || []).trim();
          if (cap) out.push(cap);
          break;
        }
        default:
          break;
      }
    }
  }
  return out.join('\n\n');
}
