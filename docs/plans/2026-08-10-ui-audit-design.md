# 2026-08-10 UI Audit & Enhancement Design

## Audit Summary

Full audit of the UPSCbooks frontend (26 EJS templates, 4 CSS files, 4 JS files, vanilla stack). The existing design system is well-structured (token-based, dark mode, responsive). No recreation needed — targeted enhancements only.

## Critical Fixes

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| 1 | Home says "2 books today" | `home.ejs:176` | Make dynamic via `books.length` |
| 2 | Hero says "47 + 104 chapters" | `home.ejs:75` | Compute from `books` data |
| 3 | Pricing says "2 books today (Indian Polity · Modern History)" | `home.ejs:176` | Dynamic book list |
| 4 | Dashboard says "2 books" in claim section | `dashboard.ejs:57` | Dynamic |

## Enhancement Areas

### Home Page
- Book grid: already shows 3 books dynamically ✓
- Hero visual: current "reader sheet" mockup is functional but static
- Features section: solid, no changes needed
- Pricing: needs content fix + visual refinement
- Add trust indicators (social proof section)

### Dashboard
- Show total chapters and book count in header
- Improve book card hover states
- Add "Start reading" CTA on each card (already exists via href)

### Reader
- Sidebar works well, no changes needed
- TTS bar is functional
- Chapter navigation is clear

### Extras Hub
- Card grid works but icons are single letters — could use SVG icons
- Counts display is useful

## Approach: Enhance In-Place

The existing design system is production-quality. I will:

1. Fix all 4 hardcoded content issues
2. Add a trust/social proof section to the home page
3. Improve the hero visual with a more dynamic mockup
4. Polish the pricing card (add savings callout)
5. Improve dashboard with summary stats
6. Add SVG icons to extras hub cards
7. Minor CSS polish (hover states, transitions, spacing)

No template recreation needed — the current architecture is clean and maintainable.
