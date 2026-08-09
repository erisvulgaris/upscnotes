import { Store } from 'express-session';
import { db } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
`);

// SQLite-backed express-session store. Extends express-session's Store so we
// inherit createSession/touch/clear defaults; only get/set/destroy are overridden.
export class SqliteSessionStore extends Store {
  constructor() {
    super();
    this.get = this.get.bind(this);
    this.set = this.set.bind(this);
    this.destroy = this.destroy.bind(this);
  }

  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?').get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) {
      cb(e);
    }
  }

  set(sid, sess, cb) {
    try {
      let expire = Date.now() + 7 * 864e5; // default 30d if no explicit expires
      if (sess.cookie && sess.cookie.expires) {
        expire = new Date(sess.cookie.expires).getTime();
        if (Number.isNaN(expire)) expire = Date.now() + 7 * 864e5;
      }
      db.prepare(
        `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`
      ).run(sid, JSON.stringify(sess), expire);
      if (cb) cb(null);
    } catch (e) {
      if (cb) cb(e);
    }
  }

  destroy(sid, cb) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      if (cb) cb(null);
    } catch (e) {
      if (cb) cb(e);
    }
  }
}
