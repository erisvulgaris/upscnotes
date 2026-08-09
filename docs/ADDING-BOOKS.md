# Adding a book to UPSCbooks

This guide is for future agents (or humans) adding a new textbook to the
platform. It covers the data schema, PDF extraction strategies, the import
pipeline, and wiring up per-book "extras".

## How the platform stores a book

Every book lives in two places:

1. **The SQLite DB** (`data/upscbooks.db`) — one row per chapter in the
   `chapters` table. Each chapter's content is stored as JSON in its
   `sections_json` column.
2. **`content/<slug>/`** (git-tracked, private, served behind auth at
   `/content/<slug>/...`) — the manifest, per-book extras JSON, and any media
   (maps/images).

The reader route (`/read/:slug/:num`) loads a chapter's `sections_json`, passes
it to `renderChapter()` in `src/content.js`, and serves it server-rendered.
`/book/:slug` — the Extras hub — reads the support JSON files from
`content/<slug>/`.

### Chapter schema (`sections_json`)

```json
{
  "number": 18,
  "title": "Chapter title",
  "sections": [
    {
      "id": "18.1",       // unique, used for #sec-<id> anchors
      "num": "1",
      "title": "Section title",
      "blocks": [
        { "kind": "para",   "runs": [{ "text": "...", "bold": false, "italic": false }] },
        { "kind": "subhead","runs": [...] },
        { "kind": "alert",  "variant": "note", "runs": [...] },
        { "kind": "note",   "runs": [...] },
        { "kind": "image",  "src": "/c2/<book>/images/fig01.png", "caption_runs": [...] },
        { "kind": "table",  "head": {"cells":[{"runs":[...],"th":true}]}, "rows": [[{"runs":[...]}]] }
      ]
    }
  ]
}
```

Block kinds supported by `src/content.js`: `para`, `subhead`, `alert`, `note`,
`image`, `table`. The table renderer accepts **both** the canonical
`{cells:[{runs,th}]}` shape and the legacy shape (rows as arrays of
`{paras:[{runs}]}`) — verified against Spectrum's own tables.

## The import tool

`tools/import-book.mjs` is the single entry point. Books are declared in a
`BOOKS` registry at the top of the file:

```js
{
  slug: 'spectrum-modern-india',
  title: 'A Brief History of Modern India',
  author: 'Rajiv Ahir',
  description: '...',
  color: '#1E3A5F',
  dataDir: path.join(ROOT, '..', 'spectrum', 'data', 'spectrum'),
  assetsDir: path.join(ROOT, '..', 'offline-site', 'assets'),   // or null
}
```

Run with `npm run import-books` (all) or `npm run import-books -- <slug>` to
target one book.

What the tool does per book:

- `upsertBook` (registers/updates the book), then `replaceChapters` which
  reads `manifest.json` in `dataDir` (a JSON array of chapter objects) and
  writes each to the DB. The manifest is produced by your build/extraction
  script.
- Copies extra support JSON from `dataDir` into `content/<slug>/`:
  `questions.json`, `flashcards.json`, `mindmaps.json`, `palette_terms.json`,
  `mains_bank.json`, `mains_frameworks.json`, `sections_text.json`,
  `search_index.json`, `maps.json`, `map_pyqs.json`, `timeline.json`.
  Files that don't exist are skipped (a book without extras is fine).
- Copies media from `<assetsDir>/../assets/{images,image,maps,map}` into
  `content/<slug>/{images,maps}` so figures render behind the auth gate.

After import, verify with a small node script that `listBooks()` shows the new
book and that `renderChapter()` in `src/content.js` produces valid HTML for a
sample chapter (see Spectrum import session for how).

> **Note** — `data/` is gitignored. `content/` is **not**: extras JSON and
> media belong in the repo so every deploy has them.

## Extracting a book from PDF

Prereqs in this workspace: Python with `PyMuPDF`, `pdfplumber`, `pypdf`,
`Pillow` installed. The reference extractor for the Spectrum book lives at
`C:\Users\Vulgaris\AppData\Local\Temp\opencode\build-spectrum.py` (not yet
checked into the repo — copy it into `tools/` next time a PDF book arrives).

Reusable strategy that worked for Spectrum (879-page PDF, 39 chapters):

1. **Decode the TOC first.** PyMuPDF (`page.get_toc()`) gives chapter titles
   and anchor page numbers. Read the printed page numbers from the table of
   contents and compute the printed→PDF offset (Spectrum: PDF page = printed
   page + 31, verified on a known opener).
2. **Extract spans, not plain text.** `page.get_text('dict')` gives
   `span["size"]`, `span["font"]`, `span["text"]`. Use size/font heuristics:
   - 22pt → chapter title (start a new chapter)
   - 13pt bold → section heading
   - ≤11pt bold → subheading / body emphasis
   - 8pt → box / sidebar text
   Note the y-coordinate of the "Chapter N" opener line and drop everything
   above it (unit/part divider clutter).
3. **Rejoin wrapped paragraphs.** A continuation line starts at a wider left
   x (e.g. ≥ 72 units) than a first line; merge such spans into the previous
   paragraph so TTS sentences don't break mid-sentence.
4. **Filter decorations.** Drop page headers/footers and star-bullet unit
   dividers by matching their text against known filler patterns.
5. **Keep images and tables.** Where possible record `kind: 'image'` with a
   slug-relative src and `kind: 'table'` with the canonical cell shape; the
   renderer tolerates both table shapes.
6. **Write `manifest.json`** at `dataDir/manifest.json`, and one
   `chapters/chNN.json` per chapter. Point the BOOKS registry `dataDir` at the
   folder containing `manifest.json`.

## Note on author attribution

The existing condensed book on the platform is **Himanshu Khatri**'s
(not a Spectrum summary). When importing Spectrum itself, keep the two
separate: Spectrum's author is **Rajiv Ahir**. Don't merge a source material
into an existing book's title/author — add it as its own book.

## Wiring extras for a new book

The Extras hub is generic — it drives entirely off the support JSON files in
`content/<slug>/`. Routes live in `src/routes/extras.js` (mounted at `/book`),
views in `src/views/pages/extras/*.ejs`, client logic in `public/js/extras.js`,
styles in `public/css/extras.css`.

| View            | Data file                 | Notes                                    |
|-----------------|---------------------------|------------------------------------------|
| hub             | —                         | shows counts from `extrasMeta()`         |
| quiz            | `questions.json`          | client-fetched, filter by ch/kind/style  |
| flashcards      | `flashcards.json`         | client-fetched, flip cards               |
| timeline        | `mindmaps.json` `.timeline.events` | server-rendered                   |
| maps            | `maps.json` + `map_pyqs.json` | client-fetched, image lightbox        |
| mains           | `mains_bank.json`         | client-fetched, expandable               |
| glossary        | `palette_terms.json`      | server-rendered, client-filtered         |
| search          | `sections_text.json`      | client-fetched full-text search          |

Every extras route is gated with `requireAuth` + `gate` (which 403-renders the
`locked` page when no subscription). Client pages fetch their JSON from
`/content/<slug>/<file>.json` — an endpoint that already 401s unauthenticated
requests. A missing data file renders a graceful "not available yet" empty
state; a book with no extras at all simply shows a hub full of empty cards.

Entry points to the hub are already wired: an "Extras ↗" pill on each dashboard
book card and an "Extras ↗" link in the reader top bar.

## Deploying

```sh
# local
npm run import-books -- <slug>          # register the book + copy content
npm run seed:make                        # or make-seed.mjs for prod seed

# server (Docker / Dokploy)
docker compose -f docker-compose.prod.yml up -d --build
```

Then verify at the live URL: book list shows the new title, `/read/<slug>/1`
renders, tables/images render, and every extras page returns 200 for a
subscribed account and 403 for an unsubscribed one.