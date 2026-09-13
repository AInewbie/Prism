import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const SESSION_SECONDS = 12 * 60 * 60;

// One owner, bounded in-memory sessions. Restart/password change revokes every login.
export function browserSessions(password, { now = Date.now } = {}) {
  if (typeof password !== 'string' || password.length < 16 || password.length > 1024)
    throw Error('Set PRISM_BROWSER_PASSWORD to a private passphrase of 16–1024 characters.');
  const salt = randomBytes(32), expected = scryptSync(password, salt, 32);
  const sessions = new Map();
  let attempts = 0, windowStart = now();
  function prune() { for (const [id, expiry] of sessions) if (expiry <= now()) sessions.delete(id); }
  return {
    async login(value) {
      if (now() - windowStart >= 60000) { attempts = 0; windowStart = now(); }
      if (attempts >= 5) return { status: 429, error: 'Too many sign-in attempts. Wait one minute and try again.' };
      attempts++;
      if (typeof value !== 'string' || value.length > 1024) return { status: 401, error: 'Password not recognized.' };
      const actual = await derive(value, salt, 32);
      if (!timingSafeEqual(actual, expected)) return { status: 401, error: 'Password not recognized.' };
      prune();
      if (sessions.size >= 50) sessions.delete(sessions.keys().next().value);
      const id = randomBytes(32).toString('hex');
      sessions.set(id, now() + SESSION_SECONDS * 1000);
      return { status: 200, id };
    },
    valid(id) { prune(); return typeof id === 'string' && /^[a-f0-9]{64}$/.test(id) && sessions.has(id); },
    revoke(id) { sessions.delete(id); },
    clear() { sessions.clear(); },
  };
}

export function browserOrigin(value) {
  if (!value) return null; // Local testing: exact loopback origin is filled after listen.
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw Error('PRISM_BROWSER_ORIGIN must be one HTTPS origin without a path or credentials.');
  return url.origin;
}
