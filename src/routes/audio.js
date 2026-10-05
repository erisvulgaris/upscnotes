import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildManifest, audioPath, audioUrl, readAudioJson, safeSlug,
} from '../audio.js';
import { requireAuth } from '../middleware.js';
import { getActiveSubscription } from '../model.js';

const router = Router();

const chapterRe = /^[0-9]{1,5}$/;

// The audio is part of the paid library, so the manifest is gated too. A
// logged-out client should not be able to enumerate which chapters exist.
router.get('/manifest.json', requireAuth, (req, res) => {
  if (!getActiveSubscription(req.session.userId)) {
    return res.status(403).json({ error: 'Membership required' });
  }
  res.type('application/json');
  res.set('Cache-Control', 'private, max-age=300');
  res.json(buildManifest());
});

// Highlight timeline: which spoken sentence starts each highlighted sentence.
// Built by tools/tts/fix-sync.mjs. Membership-gated like the media.
router.get('/:slug/:chapter.sync.json', requireAuth, async (req, res) => {
  if (!getActiveSubscription(req.session.userId)) {
    return res.status(403).json({ error: 'Membership required' });
  }
  const slug = safeSlug(req.params.slug);
  const chapter = req.params.chapter;
  if (!slug || !chapterRe.test(chapter)) return res.status(404).end();
  const data = await readAudioJson(`${slug}/${chapter}.sync.json`);
  if (!data) return res.status(404).end();
  res.type('application/json');
  res.set('Cache-Control', 'private, max-age=86400');
  return res.json(data);
});

// Timing sidecar for one chapter — small, and drives sentence highlighting.
router.get('/:slug/:chapter.json', requireAuth, async (req, res) => {
  if (!getActiveSubscription(req.session.userId)) {
    return res.status(403).json({ error: 'Membership required' });
  }
  const slug = safeSlug(req.params.slug);
  const chapter = req.params.chapter;
  if (!slug || !chapterRe.test(chapter)) return res.status(404).end();
  const meta = await readAudioJson(`${slug}/${chapter}.json`);
  if (!meta) return res.status(404).end();
  res.type('application/json');
  res.set('Cache-Control', 'private, max-age=3600');
  // `url` is filled in per response rather than read from the sidecar: a
  // presigned URL expires, so a cached copy would hand out a dead link.
  res.json({
    slug, chapter, title: meta.title, duration: meta.duration,
    sentenceTimings: meta.sentenceTimings, url: audioUrl(slug, chapter),
  });
});

// The audio itself. In production this is served straight from R2 via
// AUDIO_CDN_URL (see src/audio.js); locally it streams from disk.
router.get('/:slug/:chapter.opus', requireAuth, (req, res) => {
  if (!getActiveSubscription(req.session.userId)) {
    return res.status(403).end();
  }
  const slug = safeSlug(req.params.slug);
  const chapter = req.params.chapter;
  if (!slug || !chapterRe.test(chapter)) return res.status(404).end();

  const abs = audioPath(slug, chapter);
  if (!abs) {
    // No local copy — this is the deployed case, where the media lives in R2.
    // Hand back a short-lived signature instead of a 404.
    const remote = audioUrl(slug, chapter);
    if (remote && remote !== `/audio/${slug}/${chapter}.opus`) {
      return res.redirect(302, remote);
    }
    return res.status(404).end();
  }

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return res.status(404).end();
  }

  const range = req.headers.range;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'audio/ogg; codecs=opus');
  res.setHeader('Cache-Control', 'private, max-age=604800, immutable');

  // Range support is what lets the player seek within a long chapter.
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (Number.isNaN(start) || start < 0) start = 0;
      if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1;
      if (start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', end - start + 1);
      return fs.createReadStream(abs, { start, end }).pipe(res);
    }
  }

  res.setHeader('Content-Length', stat.size);
  return fs.createReadStream(abs).pipe(res);
});

export default router;