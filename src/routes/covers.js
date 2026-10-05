import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { CDN_URL, coverRedirect, coverOnDisk, COVERS_DIR, safeSlug } from '../cover.js';

const router = Router();

// Public cover serving (unlike content/ which is auth-gated).
// 1. If COVER_CDN_URL is set → redirect to the CDN URL (browser caches).
// 2. If R2 signing is configured → redirect to a short-lived presigned URL.
// 3. Otherwise → serve from disk (development).
router.get('/:slug.jpg', (req, res) => {
  const s = safeSlug(req.params.slug);
  if (!s) return res.status(404).end();

  const redirect = coverRedirect(s);
  if (redirect) {
    return res.redirect(302, redirect);
  }

  // Fall back to local disk serving.
  const file = path.join(COVERS_DIR, s + '.jpg');
  try {
    const stat = fs.statSync(file);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    return fs.createReadStream(file).pipe(res);
  } catch {
    return res.status(404).end();
  }
});

export default router;
