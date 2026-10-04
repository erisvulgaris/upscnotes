# UPSCbooks Design System

> Category: Books / Education Platform
> A digital library for civil services aspirants. Deep indigo + warm amber, serif display,
> calm reading surfaces. **Mobile-first.**

---

## 0. Mobile-first (this is the governing constraint)

Every rule below is written for a **360–390px phone** and only scales *up*.

- Base styles in each stylesheet are the phone layout. Layout changes live exclusively in
  `min-width` blocks. Never write a `max-width` rule that hides functionality — a phone must
  be able to reach everything a desktop can.
- Breakpoints: **560px** (2-up grids, 2-col filters) · **900px** (full nav replaces the
  drawer, chapter sheet becomes a side panel, TTS dock floats) · **1180px** (4-up book grid).
- Touch targets: **44×44px for standalone controls** (buttons, icon buttons, nav links, TTS
  controls). **40px minimum for dense inline chips** (filter rows, horizontal scrollers) —
  going taller would make a 6-chip filter row swallow the viewport. Icon buttons stay
  44×44 even when the glyph is 20px. Inline links inside a sentence of body copy are exempt,
  per WCAG's target-size exception for text.
- Inputs are `font-size: 16px` — below that iOS Safari zooms on focus.
- `env(safe-area-inset-bottom)` is honoured by the sticky footer nav and the TTS dock.
- `viewport-fit=cover` is set on every page that draws to the screen edge.
- Horizontal scrolling is contained: wide tables and figures get their own scroll container
  with `-webkit-overflow-scrolling: touch`. **No `100vw` + `translateX(-50%)` tricks** — they
  overflow the phone viewport.
- `body { overflow-x: hidden }` is a backstop, not a strategy.

---

## 1. Visual Theme & Atmosphere

UPSCbooks should feel like a *modern publishing house*: confident, trustworthy, calm — not a
cluttered exam portal.

- Deep indigo (**Midnight Ink**) anchors the brand: authority, focus, study-room-at-dusk calm.
- Warm amber (**Ember Gold**) is the single energetic accent, reserved for price, the offer
  and reading progress. One accent, never two.
- Warm paper backgrounds (**Parchment / Cream**), never cold pure white — the books are
  physical objects.
- Serif display for headlines (editorial, bookish); sans for UI and reading chrome.
- Flat, low-elevation surfaces with hairline borders. Shadows only on floating elements.
- Generous whitespace. Content is the hero, chrome is quiet.
- The reader stays minimal — near-zero chrome, maximum ink on paper.

---

## 2. Colour Palette & Roles

### Primary
- **Midnight Ink** `#1E2A52` — brand anchor; primary buttons, links, active nav.
- **Midnight 700** `#16203F` — hover. **800** `#101833` — gradient end, footer surface.

### Accent
- **Ember Gold** `#F5A623` — price, offer chip, reading-progress fill, TTS highlight.
- **Ember Deep** `#D98A12` — hover, and gold text **on a dark or tinted surface only**.

### Surfaces
- **Parchment** `#F7F4EE` — app background · **Cream** `#FFFDF9` — cards/surfaces
- **Paper Dark** `#F0EBE0` — wells, inset blocks · `#E8E2D4` — deeper wells

### Text
- **Ink** `#22252E` · **fg-2** `#4A4F5E` · **fg-3** `#6B7080` · **Ash** `#8A8F9D`

### Lines
- **Line** `#E4E0D4` · **Soft** `#EFECE2` · **Strong** `#D3CDBC`

### Semantic
Success `#1F8A4C` · Warning `#C98A1B` · Danger `#C0392B` · Info `#2B6CB0` — each with a
matching `*-tint` surface.

### Dark mode
Applied as `[data-theme="dark"]` on `<html>`; a tiny inline script resolves it before first
paint (no flash), and `app.js` mirrors the choice to `localStorage`. With no stored choice it
follows `prefers-color-scheme` and keeps following it until the reader overrides.

Night `#12141C` · Night Card `#1B1E28` · Night Line `#2E3340` · Night Ink `#EDEAE2`.
Brand lifts to `#8FA3E8` and gold to `#F0B44A` so both keep contrast on dark surfaces.

> **Hard rule:** `app.css`, `reader.css` and `extras.css` contain **no raw colours**. Every
> colour resolves through a `tokens.css` custom property. That is what makes dark mode work
> at all — the previous stylesheet hard-coded ~60 hex values and its dark mode was inert.

---

## 3. Typography

- **Display / headings:** `"Cambay", Georgia, serif` — self-hosted woff2 (`/assets/fonts/`).
  Cambay covers Latin **and Devanagari**, so Hindi content never falls back to a random
  system font.
- **Body / reading:** Cambay at 400/700 for book text.
- **UI / chrome:** `system-ui` stack — crisper for controls at small sizes.
- **Mono:** `ui-monospace` — codes, chapter numbers, order ids only.

### Fluid scale (min = phone, max = desktop cap)
Display `clamp(2rem → 3.5rem)` · H1 `clamp(1.6 → 2.25rem)` · H2 `clamp(1.3 → 1.75rem)` ·
H3 `clamp(1.05 → 1.2rem)` · Lead `clamp(1 → 1.15rem)` · Body `1rem` · Sm `.875` · Xs `.8125`
· 2xs `.75` · Micro `.6875`.

Line height: display 1.12 · headings 1.22–1.32 · body 1.62 · relaxed (reading) 1.75.
Reading column is `max-width: 720px`; body text is never justified.

**Every `@font-face` must declare a `unicode-range`.** A face without one is a
catch-all, and because the last matching face wins, two catch-alls were being
fetched ahead of the Latin subsets — 104.5KB of fonts on a page with no
Devanagari on it, including both preloaded files. With explicit ranges a Latin
page fetches 65KB and a page containing Hindi fetches one more. Put currency
signs and arrows you actually use (`₹` U+20B9) in the Latin range, or they drag
in the extended subset.

Brotli is enabled for every text response, and deliberately disabled for audio
and for anything carrying a `Content-Range` — compressing Opus or mangling a byte
range breaks seeking.

---

## 4. Components

**Buttons** — 44px min height (sm 34 / lg 52). `btn-primary` Midnight + Cream with a sheen
sweep on hover; `btn-ghost` hairline; `btn-gold` for the offer only; `btn-danger` for revoke.
Focus ring `0 0 0 3px color-mix(in srgb, var(--brand) 30%, transparent)`.

**Cards** — Cream surface, 1px Line border, radius 14px, **never** a box-shadow. Interactive
cards lift 2px and take a Midnight border on hover. Cards use hairline depth; only floating
elements (drawer, dock, lightbox, toast) get elevation.

**Chips** — 34px min height, pill. `chip-filter.is-active` fills Midnight. Long filter rows
use `.chip-scroll` (horizontal scroll, hidden scrollbar) rather than wrapping on a phone.

**Forms** — Cream, 1px Line, radius 8px, min-height 44px. Focus: Midnight border + ring.
Password fields get a real `Show/Hide` button wired in `app.js` (never an inline `onclick`).

**Alerts / badges** — tinted surface + 1px matching border. Status uses `badge-*` pills.

**Reveal** — `opacity + 14px translateY`, 420ms `cubic-bezier(.22,1,.36,1)`, staggered with
`--d`. Fires once per element, always behind `prefers-reduced-motion`.

---

## 5. Layout

Base unit 4px: 4 · 8 · 12 · 16 · 20 · 24 · 28 · 32 · 40 · 48 · 56 · 64 · 80 · 96.
Container `1180px`. Gutters 16 / 20 / 24px by breakpoint.
Book grid: **2 phone · 3 tablet · 4 desktop**. Feature grid: 1 · 2 · 4.
Section padding: 48 phone · 56 tablet · 64 desktop.

**Navigation** — phone: brand + theme toggle + auth CTA + burger. ≥900px: inline links,
`aria-current` with a 2px Midnight underline, inline search field, CTA. The burger opens a
right-hand drawer with a focus trap, `Escape` to close, scroll lock, and auto-close past
900px. Hidden elements use `display: none` — never `visibility: hidden` — so they cannot
receive focus or read to assistive tech.

---

## 6. Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | none | default surfaces |
| Hairline | `0 0 0 1px var(--line)` | card edges |
| Raised | `0 2px 6px rgba(20,22,30,.08)` | popovers |
| Floating | `0 10px 30px rgba(20,22,30,.16)` | drawer, lightbox |
| Dock | top hairline + upward shadow | reader TTS dock, mobile |

Amber glow `0 0 60px rgba(245,166,35,.12)` behind the pricing card only.

---

## 7. The reader

The highest-value surface; it gets its own opinions.

- **Top bar** — back, chapter-list button, current chapter, text-size, study-tools. 60px.
- **Chapter sheet** — bottom sheet on phone (86vh, rounded top, safe-area padding), fixed
  side panel ≥900px. Live search: 1 character filters titles locally, 2+ hits the server.
- **Reading column** — 720px max, line-height 1.75, generous paragraph spacing.

**Type scale for reading, measured rather than guessed.** A UI body size of 16px is
wrong here, because the phone column is only ~345px wide: anything larger drops the
line under 40 characters and the text reads as chopped. So the reader body is pinned
at 16px on phones and steps to 18px at 700px and 19px at 1100px — about 43
characters per line at 390px, and 70–80 at 1440px. Explicit breakpoints, not a
`vw` term: a fluid term grows fastest exactly where there is least room for it.

- **Wide content** — tables get `min-width` inside a scroll wrapper; figures are fluid with
  a border and open in a lightbox.
- **Continuous reading** — the next chapter is pre-fetched as a fragment, appended with its
  `data-sid` ids renumbered so a single reading queue spans chapters.
- **Text size** — `--font-scale` on `:root`, stepped S/M/L/XL, persisted.
- **Progress bar** — 3px gradient hairline, `role="progressbar"` with a live `aria-valuenow`.

### Where the text-to-speech dock sits

A layout decision, not a preference — and it was wrong twice.

- **<900px** — a full-width **bottom bar**. It necessarily overlays whatever is at
  the foot of the viewport, which is correct mobile behaviour. `body.reading`
  reserves `dock + safe-area` so the end of a chapter is never trapped under it.
- **900–1279px** — a **floating 208px dock** in the right margin. There is not
  enough width for both a 720px centred column and a floating panel, so the
  reading column moves left and narrows to 640px to give the dock its own space.
- **≥1280px** — a **floating 208px dock**, widening to 384px only while the
  options panel is open. The 720px centred column ends at
  `(viewport + 720) / 2`, which the dock clears at every width from 1280px up.

A 380px floating dock sat on top of the right-hand end of the reading column at
*every* scroll position, not just the last few lines. Verified by sweeping five
scroll positions per viewport and asserting that no on-screen text rectangle
intersects the dock.

### Text to speech (the differentiator)

Sentence-level playback over server-rendered `.tts-sent[data-sid]` spans.

- Tap **any sentence** to read from that point.
- Real **pause / resume**, not cancel-and-restart.
- **Speed presets** (0.75× / 1× / 1.25× / 1.5× / 2×) — never a free-dragging slider, which
  re-triggered speech on every pixel.
- **Voice picker** from the installed English voices; voice, speed, follow-along and
  auto-next-chapter all persist in `localStorage`.
- **Follow along** — the active sentence scrolls to centre and is highlighted; already-read
  sentences carry a faint brand tint.
- **Auto next chapter** — when the queue empties, the next chapter is fetched and playback
  continues without dropping.
- **Position restored** per book+chapter on reload.
- **Keyboard** — `Space` play/pause, `J`/`K` sentence, `T` options, `S` stop (suppressed
  while typing). Auto-pauses when the tab is hidden.
- Degrades honestly: if the browser has no speech engine the dock says so instead of
  showing dead controls.
- The dock is a **bottom dock on phone** and a **floating 380px panel ≥900px**;
  `body.reading` reserves `calc(dock + safe-area)` so the dock never covers the last lines.

---

## 8. Accessibility

- Skip link on every page (`#main`, or `#rd-body` in the reader).
- Visible `:focus-visible` rings everywhere; `:focus { outline: none }` alone is never used.
- `aria-current="page"` on the active nav item; `aria-expanded` on burger and TTS options.
- Icon-only controls carry `aria-label`. The theme toggle announces its next state.
- Live regions for async counts, filter results and payment messages.
- All form inputs have real `<label>`s (`.sr-only` where visual clutter would hurt).
- Status colours are never the only signal — badges and text carry meaning too.
- `prefers-reduced-motion` disables reveal, smooth scroll and the number animation.

---

## 9. Content rules

- **No invented numbers.** Every count on a page comes from the database or the content
  bundle. No "50,000+ students", no hardcoded book totals.
- **No dead links.** `href="#"`, anchors with no target, and links to pages that do not
  exist are bugs. If a tool has no data it is not offered.
- **Inline SVG icons only** (1.6–1.8px stroke, `currentColor`). No emoji as icons, no icon
  font, no CDN.
- **Self-hosted fonts only** — no third-party font CDN.
- Headline serif, body sans/serif, never mixed within a role.
- Never put amber text on a light background; use Ink text on a gold fill.
- Every page needs a real `<title>` and a real meta description.

---

## 10. Iteration guide

1. Start from `tokens.css`. If a colour or font is not a token, add the token first.
2. Write the phone layout first; add breakpoints after.
3. Check the dark theme before calling a screen done.
4. Verify: 44px targets, no horizontal scroll at 360px, keyboard reachability, live-region
   updates, and no console errors.
5. Run the Canary QA session across 390px and 1440px before pushing.