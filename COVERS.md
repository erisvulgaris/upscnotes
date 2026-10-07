# Book covers

Covers are public content: they appear on the library grid, the home page and
each book's reader header, so they are served without the sign-in gate that
protects `/content`.

## Where a cover lives

One R2 object per book, keyed by slug:

```
covers/<slug>.jpg
```

That single path is the whole contract. `GET /covers/<slug>.jpg` resolves it in
this order:

| Condition | Result |
| --- | --- |
| `COVER_CDN_URL` set | 302 to `$COVER_CDN_URL/<slug>.jpg` |
| R2 credentials present | 302 to a short-lived presigned R2 URL |
| neither | streams `covers/<slug>.jpg` from disk (development) |

`books.cover` holds the file extension (`jpg`) or `''` for "no cover". A book
with `''` falls back to the generated cover art in the templates, so a missing
cover degrades to a placeholder rather than a broken image.

## Environment

```ini
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_BUCKET=upsc-books
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...

# Optional. Set to a public r2.dev subdomain or a custom domain and the browser
# fetches covers straight from R2, skipping the app entirely. Leave empty to
# use presigned URLs, which keeps the bucket private.
COVER_CDN_URL=

# Optional. Presigned URL lifetime in seconds (default 3600, clamped 60..86400).
COVER_URL_TTL=3600
```

Both modes are worth knowing about:

- **Presigned (default).** The bucket stays private. Each cover gets a signed URL
  valid for `COVER_URL_TTL`. Costs one app request per uncached image.
- **Public CDN.** Set `COVER_CDN_URL` to an `r2.dev` subdomain. Covers become
  cacheable by the browser and CDN, and the app stops proxying them. Appropriate
  here precisely because cover art is not paid content.

To enable the public route on the bucket, serve it from R2 (r2.dev) or put a
domain in front of it. Do not reuse this pattern for audio.

## Uploading covers from the admin panel

**Admin → Books**, then use the picker in a row's Actions column. Uploads go
straight to R2 and appear site-wide immediately; nothing else needs re-running.

Accepted: JPEG, up to 4 MB. The file type is confirmed from the image's magic
bytes, not the browser-supplied content type, so a `.png` renamed to `.jpg` is
rejected rather than stored under the wrong key. **Remove** deletes the R2
object and clears `books.cover`.

Only JPEG is accepted because the R2 key, the route and every template URL are
`.jpg`. Storing PNG or WebP bytes under that key would serve them with a
mismatched content type. Supporting other formats means threading the extension
through `coverUrl()` into the templates and adding an image library to convert
uploads, since none is installed here.

## Bulk fetching from Open Library

```bash
node tools/covers/fetch-covers.mjs        # writes covers/*.jpg + provenance.json
node tools/covers/upload-covers.mjs --upload
```

`fetch-covers.mjs` records what it matched and what it could not in
`covers/provenance.json`, which is tracked in git even though the images are
not. Most unmatched titles are NCERT textbooks whose generic names ("Geography",
"Economics") collide with unrelated Open Library editions, so they are safer to
upload by hand than to match automatically.

`upload-covers.mjs --clean` removes a stray `covers/test.txt`.

## Note on `seed/`

`books.cover` lives in SQLite, so a cover uploaded in production only persists
where the database does. `seed/upscnotes.db` is a snapshot; it is not rewritten
by uploads. Regenerate it with `node tools/make-seed.mjs` if you want the
seeded covers to change too.