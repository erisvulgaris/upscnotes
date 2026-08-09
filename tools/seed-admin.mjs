import 'dotenv/config';
import { db, migrate } from '../src/db.js';
import { getUserByEmail, createUser, setUserRole } from '../src/model.js';

migrate();

const email = (process.env.ADMIN_EMAIL || 'admin@upscbooks.in').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || 'admin12345';
const name = process.env.ADMIN_NAME || 'UPSCbooks Admin';

let user = getUserByEmail(email);
if (!user) {
  const id = createUser({ email, password, name, role: 'admin' });
  user = getUserByEmail(email);
  console.log(`Created admin: ${email}`);
} else {
  setUserRole(user.id, 'admin');
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
  console.log(`Promoted existing user to admin: ${email}`);
}

console.log('Admin ready. (Change ADMIN_EMAIL/ADMIN_PASSWORD via .env.)');