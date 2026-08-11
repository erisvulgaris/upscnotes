# UI Overhaul Design — 2026-08-11

## Problem
The UPSCbooks site has ~30 UI issues across all pages. The most critical: the home page shows 46 books in a flat ungrouped grid, covers are identical colored rectangles, checkout is outdated, auth pages are bare, and the reader lacks progress indication.

## Sections

### 1. Home Page Library
- Limit to 8 featured books (standard textbooks + flagship NCERTs)
- Group by category: "Standard Books" / "Featured NCERTs"
- Add mini search linking to dashboard
- Fix pricing card: replace 46-title wall with categorized summary
- Remove redundant NCERT section (keep pills only)

### 2. Cover Art Placeholders
- Subject-based SVG icon overlays (book/globe/chart/scales/leaf/people)
- Vary gradient angle per book
- Add subtle pattern overlay for texture

### 3. Checkout Page
- Dynamic book count from DB
- Verify Razorpay integration
- Add trust signals

### 4. Auth Pages
- Login: error alerts, forgot password, password toggle
- Signup: password confirmation, terms checkbox, strength indicator
- Split layout on desktop

### 5. Footer
- 3-column: Brand | Quick links | Legal

### 6. Reader UX
- Reading progress bar (scroll-based)
- Simplified TTS bar
- Mobile chapter nav improvements

### 7. NCERTs Page
- Remove empty Psychology
- Add subject filter chips
- Consistent covers

### 8. Global
- Open Graph meta tags
- Back-to-top button
- Mobile hamburger nav
