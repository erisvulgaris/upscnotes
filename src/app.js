import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';

import { migrate } from './db.js';
import { SqliteSessionStore } from './session-store.js';
import { attachViewLocals } from './middleware.js';
import { attachCsrf, csrfProtect } from './csrf.js';
import { renderPage } from './render.js';
import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import readRoutes from './routes/read.js';
import extrasRoutes from './routes/extras.js';
import adminRoutes from './routes/admin.js';
import apiRoutes from './routes/api.js';
import audioRoutes from './routes/audio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-secret-change-me';

migrate();

export function createApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  // Behind Cloudflare + Traefik, honor X-Forwarded-Proto so secure cookies,
  // redirects, and req.secure behave correctly.
  app.set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(morgan('dev'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

  app.use(session({
    name: 'upscbooks.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new SqliteSessionStore(),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  }));

// Text responses dominate this app: ~67KB of CSS and ~42–60KB of HTML per
  // page. Compressed they are roughly a fifth of that, which is the single
  // cheapest win available for first paint.
  app.use(compression({
    threshold: 1024,
    filter(req, res) {
      if (req.headers['x-no-compression']) return false;
      // Audio is already compressed (Opus) and Range requests must pass through
      // untouched or the player cannot seek.
      if (/^audio\//.test(res.getHeader('Content-Type') || '')) return false;
      if (res.getHeader('Content-Range')) return false;
      return compression.filter(req, res);
    },
  }));

  app.use(express.static(path.join(__dirname, '..', 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
    etag: true,
  }));
  app.use(attachViewLocals);
  app.use(attachCsrf);
  // CSRF for every state-changing request. The Razorpay webhook is exempt —
  // it carries no session cookie and is already HMAC-signature-verified.
  app.use((req, res, next) => {
    if (req.path === '/api/payments/webhook') return next();
    return csrfProtect(req, res, next);
  });

  // Auth-guarded book media (images/maps) — content/ is private.
  const contentDir = path.join(__dirname, '..', 'content');
  app.use('/content', (req, res, next) => {
    if (!req.session.userId) return res.status(401).send('Sign in required');
    next();
  });
  app.use('/content', express.static(contentDir));

  app.use('/', publicRoutes);
  app.use('/', authRoutes);
  app.use('/', dashboardRoutes);
  app.use('/read', readRoutes);
  app.use('/book', extrasRoutes);
  app.use('/admin', adminRoutes);
  app.use('/api', apiRoutes);
  // Pre-rendered Edge TTS audio (16 kHz Opus), served from disk or R2.
  app.use('/audio', audioRoutes);

  app.use((req, res) => {
    renderPage(res, 404, '404', { title: 'Not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    renderPage(res, 500, '500', { title: 'Server error' });
  });

  return app;
}
