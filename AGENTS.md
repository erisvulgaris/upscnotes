# UPSCbooks — agent instructions

## Project overview
- Node + Express + EJS + SQLite app under `src/`.
- Dev server listens on `PORT` (default `3000`); scripts in `package.json`:
  - `npm run dev` — nodemon
  - `npm run seed-admin` — create admin account
  - `npm run import-books` — import a book bundle

## Source books
- Standard books: `C:\Users\Vulgaris\Documents\iCloudDrive\UPSC E-books`
- NCERT EPUBs: `C:\Users\Vulgaris\Documents\iCloudDrive\UPSC all ncerts EPub`
- Local junction: `upscbooks/booksrc` → standard books folder

## Image extraction workflow
- Primary tool: `tools/extract-images.py`
- It uses PyMuPDF for PDFs and direct ZIP extraction for EPUBs
- Output: `content/<slug>/images/*.webp`
- After extraction, upload to Cloudflare R2 bucket `upsc-books`
- R2 path pattern: `content/<slug>/images/<filename>.webp`
- Images are referenced in content JSON and rendered with `loading="lazy"`
- Report per book is written to `docs/<slug>_images.json`
- Master inventory is `BOOKS.md`

## Git conventions
- Use `git status` and `git diff` before committing.
- Stage only intended files; never commit secrets.
- Write concise commit messages matching the repo style.
- Do not push unless explicitly asked.

## Code conventions
- ESM in `src/`; `.mjs` for tool scripts.
- Do not add comments unless explicitly asked.
- Match existing style in whatever file you edit.

## Testing
- Prefer targeted checks over broad test sweeps.
- Do not assume a test framework; check `README.md` or `package.json` scripts first.

## Process Safety Rules

- NEVER run `Get-Process node | Stop-Process` or `taskkill /F /IM node.exe`.
- NEVER kill all Node.js, Python, browser, or terminal processes globally.
- When restarting a server, identify the exact PID or the process listening on the required port and terminate only that process.
- Never terminate Kilo, its parent terminal, MCP servers, or unrelated development processes.
- Prefer killing processes by PID or TCP port.

## Book processing rules
- Run extraction per book: `python tools/extract-images.py --book <slug>`
- For batch runs: `python tools/extract-images.py --all`
- Add `--dry-run` to skip R2 upload during testing
- After processing, update `BOOKS.md` report section
- Check `docs/<slug>_images.json` for per-book details
- New books must be added to `BOOKS` and `NCERT_BOOKS` in `tools/extract-images.py`
