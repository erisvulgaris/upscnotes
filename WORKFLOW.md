# upscnotes Book Processing Workflow

## Overview

This workflow describes the complete end-to-end process for ingesting any new PDF or EPUB book into the upscnotes platform. The workflow handles text extraction, image/chart/graph extraction, cover art extraction, audio generation, and R2 upload.

## Prerequisites

### System Requirements
- Python 3.10+
- Node.js 18+
- At least 4GB free disk space per book
- Cloudflare R2 account with `upsc-books` bucket

### Python Dependencies
```bash
pip install pymupdf paddleocr pillow boto3 python-dotenv
```

### Environment Variables
Create `.env` in project root:
```env
R2_ACCOUNT_ID=66d1f273ad2f74c2b6120e0824872054
R2_BUCKET=upsc-books
R2_ACCESS_KEY_ID=<your-key>
R2_SECRET_ACCESS_KEY=<your-secret>
R2_ENDPOINT=https://66d1f273ad2f74c2b6120e0824872054.r2.cloudflarestorage.com
```

## Workflow Steps

### Step 1: Place Source File

Copy the PDF or EPUB to the standard books directory:
```
C:\Users\Vulgaris\Documents\iCloudDrive\UPSC E-books\
```

**Important for iCloudDrive users on Windows:** Ensure the file is downloaded locally. iCloudDrive "files on demand" may show files as present but Python cannot read them. Right-click the file in Explorer and select "Always keep on this device" before proceeding.

### Step 2: Register Book

Add the book entry to `tools/extract-images.py` in both `BOOKS` and `NCERT_BOOKS` dictionaries:

```python
'my-new-book': {
    'title': 'My New Book Title',
    'author': 'Author Name',
    'src': os.path.join(BASE, r'path\to\book.pdf'),
    'type': 'pdf',  # or 'epub'
    'subject': 'Subject',
    'pages': 500  # approximate page count
},
```

Also add to `BOOKS` dict in `src/model.js`:
```javascript
'my-new-book': {
  title: 'My New Book Title',
  author: 'Author Name',
  cover: 'jpg',
  color: '#hexcolor',
  toc: '...',
  pages: 500,
  subject: 'Subject'
}
```

### Step 3: Extract Cover Art

Extract the first page as the book cover:

```bash
python tools/extract-covers.py --book my-new-book
```

This will:
1. Open page 1 of the PDF/EPUB at 150 DPI
2. Convert to JPEG format
3. Save to `covers/my-new-book.jpg`
4. Upload to R2 at `covers/my-new-book.jpg`
5. Update database `cover` field to `jpg`

**For EPUBs:** The script first tries to find a named cover image (cover.png, cover.jpg, etc.) inside the EPUB. If not found, it falls back to the first image in `OEBPS/Images/`.

### Step 4: Extract Images, Charts, and Graphs

Extract all non-text elements using PaddleOCR PP-DocLayoutV3:

```bash
python tools/extract-images.py --book my-new-book
```

This will:
1. Open the source PDF with PyMuPDF
2. For each page, use PaddleOCR LayoutDetection (PP-DocLayoutV3) to identify:
   - Images
   - Charts
   - Graphs
   - Tables
   - Formulas
3. Extract each element region as a separate image
4. Convert all to WebP format (quality 80, max 1200x1600)
5. Save to `content/my-new-book/images/p001_img00.webp`, etc.
6. Upload each image to R2 at `content/my-new-book/images/*.webp`
7. Generate report at `docs/my-new-book_images.json`

**Batch processing for all books:**
```bash
python tools/extract-images.py --all
```

**Dry run (no R2 upload):**
```bash
python tools/extract-images.py --book my-new-book --dry-run
```

**Page range extraction:**
```bash
python tools/extract-images.py --book my-new-book --pages 1-50
```

### Step 5: Generate Content JSON

Create the `sections_text.json` file for the book:

```bash
python tools/import-ncerts.mjs --book my-new-book
```

Or for standard books, use:
```bash
node tools/import-book.mjs --slug my-new-book
```

This generates:
- `content/my-new-book/manifest.json` - book metadata
- `content/my-new-book/sections_text.json` - structured content with blocks

### Step 6: Link Images to Content

Insert image references into the content JSON:

```bash
python tools/link-images.py --book my-new-book
```

This inserts `kind: "image"` blocks at the start of each chapter's first section:
```json
{
  "kind": "image",
  "src": "images/p001_img00.webp",
  "wide": false,
  "caption_runs": []
}
```

### Step 7: Generate Audio

Generate audio narration for all sections:

```bash
python tools/generate-audio.py --book my-new-book
```

Or batch:
```bash
python tools/generate-audio.py --all
```

This will:
1. Read each text block from `sections_text.json`
2. Use TTS engine (ElevenLabs/Azure/Google) to generate audio
3. Save MP3 files to `audio/my-new-book/ch001_sec001.mp3`
4. Update `audio/manifest.json` with chapter/section mappings
5. Upload audio files to R2 at `audio/my-new-book/*.mp3`

**Audio manifest format:**
```json
{
  "version": 1,
  "books": {
    "my-new-book": {
      "title": "My New Book",
      "author": "Author",
      "chapters": {
        "1": {
          "title": "Chapter 1",
          "sections": {
            "1": { "title": "Section 1", "file": "ch001_sec001.mp3", "size": 102400 },
            "2": { "title": "Section 2", "file": "ch001_sec002.mp3", "size": 98560 }
          }
        }
      }
    }
  },
  "chapterCount": 10
}
```

### Step 8: Upload All Assets to R2

Upload all content assets (images, audio, covers) to Cloudflare R2:

```bash
python tools/upload-to-r2.py --book my-new-book
```

Or upload everything:
```bash
python tools/upload-to-r2.py --all
```

R2 structure:
```
upsc-books/
├── covers/
│   └── my-new-book.jpg
├── content/
│   └── my-new-book/
│       ├── manifest.json
│       ├── sections_text.json
│       └── images/
│           ├── p001_img00.webp
│           ├── p001_img01.webp
│           └── ...
└── audio/
    └── my-new-book/
        ├── ch001_sec001.mp3
        ├── ch001_sec002.mp3
        └── ...
```

### Step 9: Database Setup

Create admin account:
```bash
npm run seed-admin
```

Import book into database:
```bash
npm run import-books -- --slug my-new-book
```

Or use the model directly:
```javascript
const { importBook } = require('./src/model.js');
await importBook('my-new-book');
```

### Step 10: Test Locally

Start the dev server:
```bash
npm run dev
```

Verify the following:
1. **Book appears in library:** `http://localhost:3000/`
2. **Cover displays:** Check `/covers/my-new-book.jpg` redirects to R2
3. **Content renders:** Open book and verify text/images load
4. **Images display:** Scroll through chapters and verify images appear
5. **Audio plays:** Test audio player in reader view
6. **Offline mode:** Run `npm run build && npm run preview` and test offline

### Step 11: Run QA

Run the pricing QA script to ensure no ₹299 leaks:
```bash
node tools/qa-pricing.mjs
```

Expected output:
```
OK: no hardcoded price leaks found
```

### Step 12: Build and Deploy

Build for production:
```bash
npm run build
```

Preview production build:
```bash
npm run preview
```

Deploy to Cloudflare Pages (or your hosting):
```bash
git add .
git commit -m "feat: add my-new-book with images and audio"
git push
```

## File Reference

| File | Purpose |
|------|---------|
| `tools/extract-covers.py` | Extract first-page covers from PDFs/EPUBs |
| `tools/extract-images.py` | Extract images/charts/graphs using PaddleOCR |
| `tools/generate-audio.py` | Generate TTS audio for all sections |
| `tools/upload-to-r2.py` | Upload all assets to Cloudflare R2 |
| `tools/import-ncerts.mjs` | Import NCERT EPUBs into content JSON |
| `tools/import-book.mjs` | Import standard books into content JSON |
| `tools/link-images.py` | Link extracted images to content sections |
| `tools/qa-pricing.mjs` | Check for pricing leaks |
| `content/<slug>/manifest.json` | Book metadata |
| `content/<slug>/sections_text.json` | Structured content |
| `content/<slug>/images/*.webp` | Extracted images |
| `audio/manifest.json` | Audio chapter/section index |
| `audio/<slug>/*.mp3` | Generated audio files |
| `covers/<slug>.jpg` | Book cover images |
| `docs/<slug>_images.json` | Per-book extraction report |

## Troubleshooting

### iCloudDrive Files Not Readable
**Symptom:** `Failed to open file` or `[Errno 22] Invalid argument`
**Fix:** Right-click the file in Windows Explorer → "Always keep on this device" → Wait for download to complete

### PyMuPDF Cannot Open PDF
**Symptom:** `mupdf.FzErrorFormat: code=7: no objects found`
**Fix:** File may be corrupted or password-protected. Try opening in Adobe Reader first.

### PaddleOCR Import Error
**Symptom:** `ModuleNotFoundError: No module named 'paddleocr'`
**Fix:** Install with GPU support: `pip install paddlepaddle-gpu paddleocr` or CPU: `pip install paddlepaddle paddleocr`

### R2 Upload Fails
**Symptom:** `R2 upload failed (403 Forbidden)`
**Fix:** Check R2 credentials in `.env`. Ensure bucket `upsc-books` exists and credentials have write access.

### Audio Generation Fails
**Symptom:** TTS provider returns error
**Fix:** Check API keys for ElevenLabs/Azure/Google. Verify network connectivity.

## Example: Complete New Book Ingestion

```bash
# 1. Copy book to source directory
cp ~/Downloads/new-book.pdf "C:\Users\Vulgaris\Documents\iCloudDrive\UPSC E-books\1. Foundation\Standard books & PYQs\Std. books\new-book.pdf"

# 2. Register in extract-images.py and model.js

# 3. Extract cover
python tools/extract-covers.py --book my-new-book

# 4. Extract images
python tools/extract-images.py --book my-new-book

# 5. Import content
node tools/import-book.mjs --slug my-new-book

# 6. Link images
python tools/link-images.py --book my-new-book

# 7. Generate audio
python tools/generate-audio.py --book my-new-book

# 8. Upload to R2
python tools/upload-to-r2.py --book my-new-book

# 9. Import to DB
npm run import-books -- --slug my-new-book

# 10. Test
npm run dev
# Visit http://localhost:3000/

# 11. QA
node tools/qa-pricing.mjs

# 12. Commit and push
git add .
git commit -m "feat: add my-new-book with images and audio"
git push
```

## Notes

- All extracted images are converted to WebP for optimal compression
- Covers are stored as JPEG for broader compatibility
- Audio files are stored as MP3 (128kbps) for streaming
- R2 path convention: `covers/<slug>.jpg`, `content/<slug>/images/*.webp`, `audio/<slug>/*.mp3`
- The platform uses presigned URLs for private R2 buckets (1-hour TTL)
- Local development serves covers and content from disk
