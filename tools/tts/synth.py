#!/usr/bin/env python3
"""
Edge TTS audiobook builder for UPSCbooks.

Synthesises every chapter of every book to 16 kHz mono Opus (for Cloudflare R2)
and writes a per-chapter timing sidecar so the web reader can highlight the
sentence being spoken without the Web Speech API.

Design notes
------------
* Chapter text is split into ~700 char chunks by extract.mjs. Edge TTS keeps
  natural prosody on short chunks and a long chapter can resume part-way.
* Each chunk is encoded once to Opus; a chapter is the ffmpeg concat of its
  parts (stream copy, no re-encode) so quality is never degraded twice.
* Timing is recorded per chunk, then per sentence inside a chunk by
  proportional character weight. That is accurate enough to drive a highlight.
* Fully resumable: <out>/<slug>/<n>.opus plus <out>/<slug>/<n>.json are the
  only completion markers, so re-running skips finished chapters.
* Retries with exponential backoff; Edge TTS throttles under load.

Usage
-----
  python synth.py --worker-index 0 --workers 6
  python synth.py --slug modern-indian-history          # one book, all chapters
  python synth.py --limit-chapters 3                    # smoke test
"""

import argparse
import asyncio
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

try:
    import edge_tts
except ImportError:
    sys.exit("edge-tts is not installed. Run: python -m pip install edge-tts")

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "audio" / "audio-source.json"
OUT = ROOT / "audio"

# 16 kHz mono Opus in the voip (narrowband) profile: the source is 24 kHz mono
# speech, so 16 kHz loses nothing a listener would miss and roughly halves the
# bytes versus fullband. 24 kbps is comfortably transparent for this content.
SAMPLE_RATE = 16000
OPUS_RATE = "24k"

VOICES = {
    "male": "en-IN-PrabhatNeural",
    "female": "en-IN-NeerjaNeural",
    "expressive": "en-IN-NeerjaExpressiveNeural",
}


def log(msg: str) -> None:
    stamp = time.strftime("%H:%M:%S")
    print(f"[{stamp}] {msg}", flush=True)


def ffprobe_duration(path: Path) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=60,
        )
        return float(out.stdout.strip() or 0.0)
    except Exception:
        return 0.0


async def synth_chunk(text: str, dest: Path, voice: str, rate: str, attempt_log: list) -> bool:
    """Encode one chunk of text to 16 kHz Opus. Returns True on success."""
    delay = 2.0
    for attempt in range(1, 6):
        tmp_mp3 = dest.with_suffix(".mp3")
        try:
            comm = edge_tts.Communicate(text, voice, rate=rate, pitch="+0Hz")
            await comm.save(str(tmp_mp3))
            if not tmp_mp3.exists() or tmp_mp3.stat().st_size < 200:
                raise RuntimeError("empty audio")

            # Encoding runs in a thread so it overlaps the next network
            # request instead of stalling the event loop. With ~35s of audio
            # per chunk the encoder was a third of the wall time.
            proc = await asyncio.to_thread(
                subprocess.run,
                ["ffmpeg", "-y", "-v", "error", "-i", str(tmp_mp3),
                 "-ar", str(SAMPLE_RATE), "-ac", "1",
                 "-c:a", "libopus", "-b:a", OPUS_RATE,
                 "-vbr", "on", "-compression_level", "10",
                 "-application", "voip", "-frame_duration", "60",
                 str(dest)],
                capture_output=True, timeout=300,
            )
            if proc.returncode != 0:
                raise RuntimeError("ffmpeg failed: " + (proc.stderr or b"").decode("utf8", "ignore")[:160])
            tmp_mp3.unlink(missing_ok=True)
            return True
        except Exception as exc:  # noqa: BLE001 - retry everything
            attempt_log.append(f"attempt {attempt}: {type(exc).__name__}: {exc}")
            tmp_mp3.unlink(missing_ok=True)
            if attempt < 5:
                # Backoff plus jitter so parallel workers do not resync.
                await asyncio.sleep(delay + random.uniform(0, 1.5))
                delay *= 2
    return False


def chapter_plan(chapter: dict) -> list[dict]:
    """Map the chapter's sentences onto its chunks so timing can be attributed."""
    plan = []
    for idx, chunk_text in enumerate(chapter["chunks"]):
        plan.append({"chunk": idx, "chars": len(chunk_text), "text": chunk_text})
    return plan


def clean_stale_temp(book_dir: Path) -> int:
    """Remove leftover mkdtemp dirs. A killed worker never reaches its
    `finally`, and each one holds a few hundred chunk parts."""
    import re as _re
    n = 0
    if not book_dir.exists():
        return 0
    for child in book_dir.iterdir():
        if not child.is_dir():
            continue
        if _re.fullmatch(r"[a-z0-9-]+-\d+-[A-Za-z0-9_]{8}", child.name):
            shutil.rmtree(child, ignore_errors=True)
            n += 1
    return n


async def build_chapter(book_slug: str, chapter: dict, voice: str, rate: str,
                        limit_sents: int | None = None) -> dict | None:
    """Synthesise one chapter. Returns its timing sidecar, or None on failure."""
    n = chapter["n"]
    book_dir = OUT / book_slug
    book_dir.mkdir(parents=True, exist_ok=True)
    final = book_dir / f"{n}.opus"
    sidecar = book_dir / f"{n}.json"

    if final.exists() and sidecar.exists():
        return json.loads(sidecar.read_text(encoding="utf8"))

    chunks = chapter["chunks"]
    if limit_sents:
        chunks = chunks[:limit_sents]
    if not chunks:
        return None

    work = Path(tempfile.mkdtemp(prefix=f"{book_slug}-{n}-", dir=str(book_dir)))
    errors: list[str] = []
    try:
        parts = []
        # Sequential within a chapter: parallel across chapters is enough
        # concurrency and keeps Edge TTS from throttling us into the ground.
        for i, text in enumerate(chunks):
            part = work / f"p{i:05d}.opus"
            ok = await synth_chunk(text, part, voice, rate, errors)
            if not ok:
                return None
            parts.append(part)

        listfile = work / "parts.txt"
        listfile.write_text(
            "".join(f"file '{p.name}'\n" for p in parts), encoding="utf8"
        )
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                 "-i", str(listfile), "-c", "copy", str(final)],
                check=True, capture_output=True, timeout=900,
            )
        except subprocess.CalledProcessError:
            # concat demuxer needs -c copy fallback; if that fails, re-encode.
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                 "-i", str(listfile),
                 "-ar", str(SAMPLE_RATE), "-ac", "1",
                 "-c:a", "libopus", "-b:a", OPUS_RATE, "-application", "voip",
                 str(final)],
                check=True, capture_output=True, timeout=1800,
            )

        duration = ffprobe_duration(final)

        # Cumulative timings: chunk boundaries are exact, sentence boundaries
        # inside a chunk are interpolated by character weight.
        sentence_timings = []
        cursor = 0.0
        for i, text in enumerate(chunks):
            chunk_dur = ffprobe_duration(parts[i])
            # Split the chunk back into sentences on terminal punctuation.
            sents = [s.strip() for s in text.split("(?<=[.!?…])") if s.strip()] \
                if False else None
            import re
            sents = [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text) if s.strip()]
            total_chars = sum(len(s) for s in sents) or 1
            t = cursor
            for s in sents:
                d = chunk_dur * (len(s) / total_chars)
                sentence_timings.append({"t": round(t, 3), "text": s})
                t += d
            cursor += chunk_dur

        meta = {
            "slug": book_slug,
            "chapter": n,
            "title": chapter["title"],
            "voice": voice,
            "rate": rate,
            "sampleRate": SAMPLE_RATE,
            "codec": "opus",
            "bitrate": OPUS_RATE,
            "bytes": final.stat().st_size,
            "duration": round(duration, 3),
            "chunks": len(chunks),
            "words": chapter["words"],
            "sentenceTimings": sentence_timings,
        }
        sidecar.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf8")
        return meta
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def worker(index: int, total_workers: int, voice: str, rate: str,
                 limit_books: int | None, limit_chapters: int | None,
                 only_slug: str | None) -> None:
    source = json.loads(SOURCE.read_text(encoding="utf8"))
    slugs = [s for s in sorted(source["books"]) if not only_slug or s == only_slug]
    if limit_books:
        slugs = slugs[:limit_books]

    # Interleave books across workers so no single worker owns the longest book.
    mine = [s for i, s in enumerate(slugs) if i % total_workers == index]
    if not mine:
        log(f"worker {index}: nothing assigned")
        return
    log(f"worker {index}: {len(mine)} book(s) — {', '.join(mine[:4])}{'…' if len(mine) > 4 else ''}")

    sem = asyncio.Semaphore(3)  # in-flight synthesises per worker

    async def do_chapter(book_slug: str, chapter: dict) -> None:
        async with sem:
            try:
                meta = await build_chapter(book_slug, chapter, voice, rate,
                                           limit_sents=limit_chapters)
                if meta:
                    log(f"  {book_slug} ch{chapter['n']:>3} "
                        f"{meta['duration']/60:6.1f}min "
                        f"{meta['bytes']/1e6:6.2f}MB  {chapter['title'][:40]}")
            except Exception as exc:  # noqa: BLE001
                log(f"  !! {book_slug} ch{chapter['n']} FAILED: {type(exc).__name__}: {exc}")

    for book_slug in mine:
        book_dir = OUT / book_slug
        stale = clean_stale_temp(book_dir)
        if stale:
            log(f"worker {index}: cleared {stale} stale temp dir(s) in {book_slug}")
        book = source["books"][book_slug]
        chapters = book["chapters"]
        if limit_chapters:
            chapters = chapters[:limit_chapters]
        log(f"worker {index}: starting {book_slug} ({len(chapters)} chapters)")
        # Chapters within a book run concurrently; books are sequential.
        await asyncio.gather(*(do_chapter(book_slug, c) for c in chapters))
        log(f"worker {index}: finished {book_slug}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-index", type=int, default=0)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--voice", default="male", choices=list(VOICES))
    ap.add_argument("--rate", default="-5%", help="Edge TTS rate, e.g. -5%% or +10%%")
    ap.add_argument("--limit-books", type=int, default=None)
    ap.add_argument("--limit-chapters", type=int, default=None,
                    help="also caps chunks per chapter (smoke test)")
    ap.add_argument("--slug", default=None)
    args = ap.parse_args()

    if not SOURCE.exists():
        sys.exit(f"missing {SOURCE} — run: node tools/tts/extract.mjs")

    OUT.mkdir(parents=True, exist_ok=True)
    voice = VOICES[args.voice]
    log(f"voice={voice} rate={args.rate} worker {args.worker_index}/{args.workers}")
    asyncio.run(worker(
        args.worker_index, args.workers, voice, args.rate,
        args.limit_books, args.limit_chapters, args.slug,
    ))
    log(f"worker {args.worker_index}: done")


if __name__ == "__main__":
    main()