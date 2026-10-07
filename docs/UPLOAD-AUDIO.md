# upscnotes audiobook upload — R2

The build is finished and verified. Everything below is what remains, and it
needs no code changes.

```
books    46
chapters 653 / 653
audio    492.3 hours, 4.70 GB (16 kHz mono Opus, 24 kbps)
sidecars 221,889 sentence timings, one JSON per chapter
manifest audio/manifest.json, 68.8 KB
```

`audio/` is gitignored. Nothing has been pushed to the repository.

## 1. Upload

Keep the layout exactly as on disk — the app derives URLs from it:

```
audio/<slug>/<chapter>.opus     the audio
audio/<slug>/<chapter>.json     timings + metadata
```

```powershell
# rclone config -> name the remote "r2" (S3 provider, endpoint
# https://<account-id>.r2.cloudflarestorage.com, access key + secret)

rclone sync audio r2:upscnotes-audio `
  --include "*.opus" --include "*.json" `
  --include "manifest.json" `
  --exclude "logs/*" --exclude "audio-source.json" --exclude "content-qa-report.json" `
  --progress --transfers 8 --checkers 16
```

Expect roughly 8,800 small files over ~4.7GB, so use a high `--transfers`
count. R2 has no egress charge, which is the point of putting it there.

Verify:

```powershell
rclone lsf r2:upscnotes-audio --recursive | Measure-Object
# expect 653 *.opus and 653 *.json under <slug>/, plus manifest.json
```

## 2. Point the app at it

```env
AUDIO_CDN_URL=https://pub-<account-id>.r2.dev
```

or your custom domain if you front R2 with one.

With that set, `src/audio.js` stops serving media from disk and returns CDN
URLs in the manifest and in the timing sidecar. The manifest itself stays
served by the app so it stays membership-gated — only the media moves.

R2 settings worth setting:

- **CORS** — allow `GET`, `HEAD` and `Range` from your origins. Without it the
  player cannot fetch the sidecar or seek.
- **Cache-Control** — leave it alone. Filenames are content-stable
  (`<slug>/<chapter>.opus` never changes), so a long immutable TTL is correct
  and safe.

## 3. Check it end to end

```powershell
node tools\check-audio.mjs        # needs $env:UPSC_COOKIE, see tools/qa/README.md
node tools\check-all-audio.mjs    # integrity across all 653 chapters
node tools\check-audio-badge.mjs  # the reader only claims audio where it exists
```

Then load a chapter in a browser with speech synthesis disabled — the
fallback should announce itself, stream, and highlight the sentence being read.

## What the fallback is, precisely

`public/js/tts.js` stays the primary path: the device's own speech engine,
which is free, offline and highlights exactly. It is used whenever the browser
has an installed voice.

`public/js/audio-fallback.js` only takes over when there is **no usable voice**
— `speechSynthesis` missing, or zero installed voices. That covers older
WebKit, some in-app browsers and locked-down enterprise builds. It loads the
sidecar, streams the Opus with `preload="metadata"` (the heaviest chapter is
49MB, so preloading it whole would mean waiting minutes before the first
sentence), and highlights by binary-searching `currentTime` against the
timings.

Sentence highlighting in the fallback is exact at chunk boundaries and
interpolated within them; see "Highlight granularity" in `docs/AUDIOBOOKS.md`.
The Web Speech path is exact throughout.

## If you ever rebuild

```powershell
node tools\tts\extract.mjs
powershell -File tools\tts\run.ps1 -Workers 12
```

Resumable — a chapter with both `.opus` and `.json` is skipped. Voice options
are `male` (default), `female` and `expressive`; all are `en-IN` Neural voices.
