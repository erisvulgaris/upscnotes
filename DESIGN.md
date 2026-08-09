# UPSCbooks Design System

> Category: Books / Education Platform
> A fresh, product-grade digital library for civil services aspirants. Deep indigo + warm amber, editorial serif display, calm reading surfaces.

## 1. Visual Theme & Atmosphere

UPSCbooks should feel like a *modern publishing house*: confident, trustworthy, and calm — not like a cluttered exam portal. The mood is editorial-product hybrid.

**Key characteristics:**
- Deep indigo (Midnight Ink) as the anchor brand color — suggests authority, focus, and the "study room at dusk" calm.
- Warm amber (Ember Gold) as the single energetic accent — used sparingly for the price, CTAs, and highlights. One accent, never two.
- Warm paper backgrounds (Parchment, Cream) rather than cold pure white — the books are physical objects, and the platform keeps that warmth.
- Serif display (Libre Caslon / Georgia) for headlines — editorial, bookish, aspirational.
- Sans body (Inter / system) for UI and reading chrome — crisp and readable.
- Flat, low-elevation surfaces with hairline borders; shadows only on floating elements (dropdowns, toasts, the reader TTS bar).
- Generous whitespace; content is the hero, chrome is quiet.
- The reader experience stays minimal — near-zero chrome, maximum ink on paper.

## 2. Color Palette & Roles

### Primary
- **Midnight Ink** (`#1E2A52`) — brand anchor; primary buttons, primary links, active nav, header accents.
- **Midnight 700** (`#16203F`) — hover state for primary buttons, footer background.

### Secondary & Accent
- **Ember Gold** (`#F5A623`) — price, sale tag, "lifetime" highlight, focus on the offer. Use on dark surfaces with dark text (contrast).
- **Ember Deep** (`#D98A12`) — hover/emphasis for gold elements.

### Surface & Background
- **Parchment** (`#F7F4EE`) — app background.
- **Cream** (`#FFFDF9`) — card / raised surface background.
- **Paper Dark** (`#F0EBE0`) — subtle tint sections and wells.

### Neutrals & Text
- **Ink** (`#22252E`) — primary text.
- **Slate** (`#4A4F5E`) — secondary text.
- **Ash** (`#8A8F9D`) — muted text, metadata, captions.
- **Line** (`#E4E0D4`) — hairline borders, dividers.
- **Hairline** (`#EFECE2`) — softer borders.

### Semantic & Accent
- **Success** (`#1F8A4C`) — active subscription, correct answers, success toasts.
- **Warning** (`#C98A1B`) — lapsed subscription, warnings.
- **Danger** (`#C0392B`) — errors, destructive actions, wrong answers.
- **Info** (`#2B6CB0`) — informational notes.

### Dark Mode
- **Night** (`#12141C`) — dark app background.
- **Night Card** (`#1B1E28`) — dark card surface.
- **Night Line** (`#2A2E3A`) — dark hairline.
- **Night Ink** (`#EDEAE2`) — dark-mode text.
- Dark mode keeps Midnight Ink anchors but shifts surfaces to Night, text to Night Ink.

### Gradient System
- **Hero wash**: subtle vertical `linear-gradient(Parchment → Cream)` for the hero; optional faint radial amber glow behind the pricing card.
- **Aurora atmosphere**: layered radial washes (Midnight tinted + a single warm Ember wash), always under 25% alpha, drifting on a 20s+ loop. Applied to hero and page shells only — never over reading content.
- **Brand gradient**: `Midnight Ink → #33458F → amber-mixed Midnight` reserved for the book cover art, favicon, and the brand mark.
- Never gradient text; larger surfaces capped at two–three brand stops.

## 3. Typography Rules

### Font Family
- **Headline:** `"Libre Caslon Display", Georgia, "Times New Roman", serif`
- **Body:** `Inter, -apple-system, "Segoe UI", Roboto, sans-serif`
- **Mono:** `ui-monospace, "JetBrains Mono", Menlo, monospace` (rare — codes, IDs)

### Hierarchy
| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|---|---|---|---|---|---|---|
| Display | Headline | 40–56px | 700 | 1.08 | -0.01em | Landing hero only |
| H1 | Headline | 32px | 700 | 1.15 | -0.01em | Page titles |
| H2 | Headline | 26px | 700 | 1.2 | 0 | Section headers |
| H3 | Body | 19px | 650 | 1.3 | 0 | Cards, sub-blocks |
| Body | Body | 16px | 400 | 1.6 | 0 | Default text |
| Body Small | Body | 14px | 400 | 1.55 | 0 | Secondary text |
| Caption | Body | 12.5px | 500 | 1.4 | 0.02em | Metadata, labels |
| Overline | Body | 11px | 700 | 1.3 | 0.09em | Uppercase section labels |
| Price | Body | 44px | 750 | 1 | -0.02em | ₹299 numeral |

### Principles
- Headlines in serif, UI in sans — never mix the two roles.
- Body line-height 1.6 always; reading column max 68ch.
- Uppercase overlines only for tiny labels; letter-spacing ≥ 0.06em when uppercase.
- Never justify body text.

## 4. Component Stylings

### Buttons
- **Primary:** Midnight Ink background, Cream text, radius 10px, 14px padding 20px. Hover: Midnight 700. Active: translateY(1px). A soft sheen sweep glides across on hover.
- **Ghost:** transparent, 1px Line border, Ink text. Hover: Paper Dark background.
- **Gold:** Ember Gold background, Ink text (dark text on gold for contrast). For the "claim offer" CTA.
- Sizes: `--btn-sm` (34px), default (44px), `--btn-lg` (52px). Full-width variant `btn-block`.
- Focus ring: 3px `color-mix(in srgb, var(--accent) 40%, transparent)`.

### Icons & Ornaments
- Use inline **SVG stroke icons** (1.6px, `currentColor`) — no icon font, no CDN. Stroke inherits Ink/Brand; accents use Ember Gold only for the offer halo.
- Feature cards carry a 40px tinted `ico` tile (brand 8% fill, radius 12px).
- Flat iconography only — never filled icons on gradient blobs.

### Motion
- Scroll-reveal: content enters with `opacity + 16px translateY`, 480ms `cubic-bezier(.22,1,.36,1)`, staggered via a custom `--d` delay. Respect `prefers-reduced-motion`.
- Hover micro-interactions: buttons lift 1–2px with a gold sheen; book covers zoom the interior to 103%.
- Ambient only: hero blob drift (~20s), floating info chips (6–9s ease-in-out). Nothing bounces.
- Entrances once per scroll; never re-trigger.

### Cards & Containers
- **Card:** Cream bg, 1px Line border, radius 14px, padding 20px, no shadow. Hover (interactive): 1px Midnight border + translateY(-2px).
- **Book card:** cover block (2:3 ratio) + title + author + chapter chip.
- **Pricing card:** Cream bg, 1px Midnight border, radius 18px, subtle amber glow on top edge.

### Inputs & Forms
- Background Cream, 1px Line border, radius 10px, padding 10px 14px, height 44px.
- Focus: Midnight border + focus ring. Placeholder: Ash.
- Labels: Caption style, Ink, margin-bottom 6px.

### Navigation
- Sticky header, Parchment/translucent backdrop-blur, hairline bottom border.
- Brand mark: square Midnight tile with "U" + wordmark. Nav links: Ink, hover underline accent.
- Active page: Midnight text + 2px Midnight underline.

### Image Treatment
- Book covers: radius 10px, thin Line border, no drop shadow.
- Chapter figures: full-width, radius 12px, light Line border, click-to-zoom.

### Distinctive Components
- **Offer banner / price:** amber chip with "₹299 lifetime" — dark Ink text on Ember Gold pill.
- **Chapter chip:** caption-style count badge (e.g. "104 chapters").
- **TTS bar:** floating pill, Cream bg, elevation shadow, radius 999px.
- **Alert:** tinted panels (success/error/info) with 1px matching border.

## 5. Layout Principles

### Spacing System
Base unit **4px**. Scale: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 96.
- Section vertical: 96px desktop, 64px tablet, 48px phone.
- Card padding: 20px. Grid gap: 20px.

### Grid & Container
- 12-column grid. Container max-width **1120px**, gutters 24px desktop / 16px tablet / 12px phone.
- Book grid: 4 columns desktop, 2 tablet, 2 phone (covers read well even at 2-up).
- Reading column: max-width **760px**, centered.

### Whitespace Philosophy
- Chrome is quiet: nav height 60px, footer sparse.
- Hero: full-height-ish, generous bottom padding, headline + sub + one CTA row.
- Sections separated by whitespace more than by rules.

### Border Radius Scale
- `--radius-sm: 8px` (chips, inputs), `--radius-md: 12px` (images), `--radius-lg: 14px` (cards), `--radius-xl: 18px` (pricing), `--radius-pill: 999px` (tags, TTS bar).

## 6. Depth & Elevation

| Level | Treatment | Use |
|---|---|---|
| Flat | none | default surfaces |
| Hairline | `0 0 0 1px var(--line)` | card edges, focus |
| Raised | `0 2px 6px rgba(20,22,30,.08)` | TTS bar, dropdowns |
| Floating | `0 10px 30px rgba(20,22,30,.16)` | toasts, modals, mobile drawer |

### Shadow Philosophy
- Only floating/transient elements cast shadows. Cards never shadow — they use hairline borders.
- Amber glow: `0 0 60px rgba(245,166,35,.10)` behind pricing card only.

### Decorative Depth
- Atmosphere is ambient, never a picture: aurora washes, a whisper of 1px paper dots, and a handful of inline SVG icons. Every decorative layer ≤ 25% alpha.
- Reading sheets stay absolutely chrome-free — no blobs, no grain behind text columns.

## 7. Do's and Don'ts

**Do:**
- Use Midnight Ink for primary actions and links.
- Use Ember Gold only for the offer/price and its immediate halo — never for large surfaces.
- Keep reading surfaces Cream/Parchment with near-zero chrome.
- Use serif for every heading; sans for everything else.
- Give hairline borders to all cards; reserve shadows for floating elements.
- Maintain ≥ 68ch reading width and 1.6 line-height in the reader.
- Use uppercase overlines only for micro-labels.
- Add motion sparingly and always behind `prefers-reduced-motion`.
- Pull every new surface from `tokens.css`, including the atmosphere tokens.

**Don't:**
- Don't use pure black (`#000`) or pure white (`#fff`) for text/surfaces.
- Don't use more than one accent color on a screen.
- Don't put amber text on white (contrast fail) — use Ink text on gold fills.
- Don't add box-shadows to cards.
- Don't justify text or hyphenate body copy.
- Don't mix a third font family in.
- Don't clutter the reader with sidebars or heavy headers.
- Don't animate reading text, price numerals, or anything the eye tracks while studying.

## 8. Responsive Behavior

### Breakpoints
| Name | Width | Changes |
|---|---|---|
| Phone | < 640px | Stack hero, book grid 2-col, nav collapses to links (brand first), reader padding tightens |
| Tablet | 640–1024px | Book grid 2–3 col, hero stacks |
| Desktop | > 1024px | Full layout, book grid 4 col, fixed sidebar allowed in admin |

### Touch Targets
- All tappable ≥ 44px hit area (buttons, links, TTS controls 44px).
- Reader sentence spans are clickable (start TTS) — min 20px effective padding.

### Collapsing Strategy
- Header: brand + CTA row persists; nav links scroll away / fold into menu on phone.
- Reader: TTS bar becomes full-width bottom bar on phone.
- Admin tables: horizontal scroll within card on phone.

### Image Behavior
- Book covers: `aspect-ratio: 2/3`, `object-fit: cover`, scale 100% → hover 103%.
- Chapter figures: fluid width, `max-height: 70vh`, zoomable in lightbox.

## 9. Agent Prompt Guide

### Quick Color Reference
- Primary: **Midnight Ink** (`#1E2A52`)
- Accent: **Ember Gold** (`#F5A623`)
- Background: **Parchment** (`#F7F4EE`), surface **Cream** (`#FFFDF9`)
- Text: **Ink** (`#22252E`), **Slate** (`#4A4F5E`), **Ash** (`#8A8F9D`)
- Border: **Line** (`#E4E0D4`)
- Success `#1F8A4C` · Warning `#C98A1B` · Danger `#C0392B` · Info `#2B6CB0`
- Dark: **Night** `#12141C`, **Night Card** `#1B1E28`, **Night Line** `#2A2E3A`, **Night Ink** `#EDEAE2`

### Example Component Prompts
- "Primary button: Midnight Ink fill, Cream text, radius 10px, hover Midnight 700."
- "Pricing card: Cream surface, Midnight border, Ember Gold price numeral with Ink text."
- "Book card cover placeholder: Midnight fill, white serif title, overline 'UPSCBOOKS', author bottom."
- "Reader TTS bar: floating pill, Cream, radius 999px, elevation shadow, no border."
- "Error alert: Cream surface, Danger border, Danger text caption."

### Iteration Guide
1. Start every new screen from tokens.css — never hardcode a color/font.
2. Match the section roles above; verify the palette stays within Midnight/Ember/Neutrals.
3. Check contrast: body text Slate on Parchment, Ink text on Ember Gold, Cream text on Midnight.
4. Confirm the reader surface stays chrome-free and the reading column ≤ 760px.
5. Re-check dark mode (Night surfaces) for every new screen before finishing.
