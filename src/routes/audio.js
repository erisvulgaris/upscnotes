import { Router } from 'express';
import fs from 'node:fs';
import {
  buildManifest, audioPath, audioUrl, readTimings, safeSlug,
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

// Timing sidecar for one chapter â€” small, and drives sentence highlighting.
router.get('/:slug/:chapter.json', requireAuth, (req, res) => {
  if (!getActiveSubscription(req.session.userId)) {
    return res.status(403).json({ error: 'Membership required' });
  }
  const slug = safeSlug(req.params.slug);
  const chapter = req.params.chapter;
  if (!slug || !chapterRe.test(chapter)) return res.status(404).end();
  const meta = readTimings(slug, chapter);
  if (!meta) return res.status(404).end();
  res.type('application/json');
  res.set('Cache-Control', 'private, max-age=3600');
  res.json({
    slug: meta.slug, chapter: meta.chapter, title: meta.title,
    duration: meta.duration, url: audioUrl(slug, chapter),
    sentenceTimings: meta.sentenceTimings,
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
  if (!abs) return res.status(404).end();

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