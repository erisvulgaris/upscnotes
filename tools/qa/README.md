# QA suite

Browser-level checks that run under the [Canary](https://github.com/0xnyn/canary)
harness. They exist because every serious bug found during the mobile-first
rebuild was invisible in the source and obvious in a rendered page: a header
search that crushed the wordmark into single-character columns, a floating
dock covering the end of every chapter, cover text at 1.6:1 in dark mode, a
question bank building a 616,000px DOM.

## Running them

```powershell
# from the repo root, with the dev server on 4177
canary session start --name upscbooks-qa
canary run tools\qa\layout-a11y.js       --session <id> --step a --timeout 200
canary run tools\qa\overflow.js          --session <id> --step b --timeout 180
canary run tools\qa\reader-dock.js       --session <id> --step c --timeout 200
canary run tools\qa\keyboard.js          --session <id> --step d --timeout 280
canary run tools\qa\contrast.js          --session <id> --step e --timeout 200
canary run tools\qa\quiz-pager.js        --session <id> --step f --timeout 240
canary run tools\qa\timeline.js          --session <id> --step g --timeout 240
canary run tools\qa\mains-maps.js       --session <id> --step h --timeout 240
canary run tools\qa\reader-typography.js --session <id> --step i --timeout 220
canary run tools\qa\font-subsetting.js   --session <id> --step j --timeout 200
```

**Raise `--timeout` when the audiobook build is running.** A dozen ffmpeg and
Edge TTS workers saturate the CPU, and sweeps that finish in 40s idle will hit
the wall at 200s under load. Pause the build if a sweep needs to be reliable:

```powershell
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -like '*synth.py*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
# ... run the sweep ...
powershell -File tools\tts\run.ps1 -Workers 12      # resumable, loses nothing
```

## What each one asserts

| Script | Asserts |
|---|---|
| `layout-a11y.js` | 4 widths x 5 routes: no horizontal overflow, no `href="#"` or `/#features`, a visible focus ring on a real (non-hidden) button, exactly one `h1`, a skip link, `alt` on every image, no emoji used as icons, a meta description, and no console errors. |
| `overflow.js` | The page cannot be scrolled sideways, and nothing sits past the viewport outside a scroll container or a closed dialog. Public pages at 320/360/390px. |
| `overflow-auth.js` | The same, on `/dashboard`, the three admin tables and the question bank — the surfaces where a genuinely wide table exists. |
| `reader-dock.js` | The TTS dock never intersects on-screen reading text at five widths and two scroll positions, and the end of a chapter is never trapped under it. Checks both axes: the floating dock sits *beside* the column, not under it. |
| `keyboard.js` | Tabs through five pages plus the reader. Every stop has a visible ring, none lands on a hidden element, the skip link is the first stop and becomes visible, and no target is under 24px. |
| `contrast.js` | WCAG AA on the landing page in both themes. Composes the cover `::before` scrim over the cover colour, which a naive `backgroundColor` walk cannot see. |
| `quiz-pager.js` | The question bank renders a page at a time, tops up on scroll, narrows on filter, shows an empty state on no match, and repopulates when cleared. |
| `timeline.js` | Events are genuinely chronological — it re-derives the year keys and counts inversions — with no duplicate rows, and search still narrows. |
| `mains-maps.js` | Mains search and chapter filter work; no-match state appears; maps render with no broken images; the lightbox opens and closes on Escape. |
| `reader-typography.js` | Line length in characters per line, measured with canvas at the paragraph's real font, across four widths. Catches both "too wide to read" and "so few characters it feels chopped". |
| `font-subsetting.js` | Watches `Network.requestWillBeSent` to confirm a Latin page does not fetch the Devanagari subsets, and that a page with Hindi does. |

## Three traps these scripts fell into

All three produced false failures first, and all three are worth remembering:

- **`documentElement.scrollWidth` is not an overflow signal when `body` has
  `overflow-x: hidden`.** The admin members table is 620px inside a 375px
  scroller, which inflates `scrollWidth` by 174px even though the reader
  cannot scroll the page sideways and every column — including the rightmost
  "Actions" column — is reachable by scrolling the table. Six candidate CSS
  fixes were tried and none moved the metric, which is what proved the metric
  was wrong rather than the layout. Assert *"can the user scroll the page
  sideways?"* instead, and treat `scrollWidth` as a hint.
- **`offsetParent !== null` is not "visible".** The mobile drawer uses
  `visibility: hidden`, so its buttons report a bounding box but cannot take
  focus. A focus probe that stops there reads "no focus ring" on a control
  that is correctly unfocusable.
- **A full-width fixed bottom bar always overlaps something.** On a phone the
  TTS dock necessarily covers whatever is at the foot of the viewport. Asserting
  "no overlap at any scroll position" is the wrong test; the right one is that
  the *end of the document* stays reachable and that a floating dock is clear.

## Non-browser checks

These need Node and a signed-in session rather than a browser:

```powershell
node tools\check-audio.mjs          # Range requests, timings, traversal, container magic
node tools\check-compression.mjs    # brotli on text, never on audio or a byte range
node tools\measure-audio.mjs        # word counts and estimated hours per book
node tools\audit-content.mjs        # typographic findings in the stored chapter text
```

`check-audio.mjs` needs a session cookie in `$env:UPSC_COOKIE`; see
`docs/AUDIOBOOKS.md`.