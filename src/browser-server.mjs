import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createApp } from './server.mjs';
import { browserSessions, browserOrigin, SESSION_SECONDS } from './browser-session.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicAssets = new Map([
  ['/signin', ['browser-login.html', 'text/html; charset=utf-8']],
  ['/browser-login.js', ['browser-login.js', 'text/javascript; charset=utf-8']],
  ['/browser-login.css', ['browser-login.css', 'text/css; charset=utf-8']],
  ['/logo.svg', ['logo.svg', 'image/svg+xml']],
]);
const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
async function readBody(req, limit) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(Error('Request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
    return data;
  } catch { throw Object.assign(Error('Send a JSON object.'), { status: 400 }); }
}

export async function createBrowserApp({ directory, env = process.env, fetcher, now } = {}) {
  const configuredOrigin = browserOrigin(env.PRISM_BROWSER_ORIGIN);
  const auth = browserSessions(env.PRISM_BROWSER_PASSWORD, { now });
  const secure = !!configuredOrigin;
  const cookieName = secure ? '__Host-prism-browser' : 'prism-browser-local';
  const liveEnabled = env.PRISM_BROWSER_ALLOW_LIVE === '1';
  const backend = createApp({ directory: directory || env.PRISM_BROWSER_DATA_DIR ||
    join(homedir(), '.local', 'share', 'prism-browser'), env, fetcher });
  try {
    await new Promise((done, reject) => { backend.server.once('error', reject); backend.server.listen(0, '127.0.0.1', done); });
  } catch (error) { await backend.close(); throw error; }
  const upstream = 'http://127.0.0.1:' + backend.server.address().port;
  const cookie = (id, age) => `${cookieName}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  let closing = false;
  const pending = new Set();
  const server = createServer(async (req, res) => {
    const end = (status, data, type = 'application/json; charset=utf-8') => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': type });
      res.end(Buffer.isBuffer(data) ? data : type.startsWith('application/json') ? JSON.stringify(data) : data);
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Frame-Options', 'DENY');
    const origin = configuredOrigin || 'http://127.0.0.1:' + server.address()?.port;
    try {
      if (closing) return end(503, { error: 'Server is shutting down.' });
      if (req.headers.host !== new URL(origin).host) return end(403, { error: 'Untrusted host.' });
      const mutation = !['GET', 'HEAD'].includes(req.method);
      if ((mutation || req.headers.origin) && req.headers.origin !== origin)
        return end(403, { error: 'Cross-origin request blocked.' });
      if (!req.url.startsWith('/') || req.url.startsWith('//')) return end(400, { error: 'Invalid path.' });
      const path = new URL(req.url, origin).pathname;
      if (mutation && !req.headers['content-type']?.startsWith('application/json'))
        return end(415, { error: 'JSON content type required.' });
      const cookies = String(req.headers.cookie || '').split(';').map(x => x.trim()).filter(x => x.startsWith(cookieName + '='));
      const id = cookies.length === 1 ? cookies[0].slice(cookieName.length + 1) : '';
      if (path === '/api/auth/login' && req.method === 'POST') {
        const data = await readBody(req, 5000), result = await auth.login(data.password);
        if (closing) return end(503, { error: 'Server is shutting down.' });
        if (result.id) {
          auth.revoke(id);
          res.setHeader('Set-Cookie', cookie(result.id, SESSION_SECONDS));
          return end(200, { signedIn: true });
        }
        if (result.status === 429) res.setHeader('Retry-After', '60');
        return end(result.status, { error: result.error });
      }
      if (path === '/api/auth/logout' && req.method === 'POST') {
        auth.revoke(id);
        res.setHeader('Set-Cookie', cookie('', 0));
        return end(200, { signedIn: false });
      }
      const asset = publicAssets.get(path);
      if (asset && req.method === 'GET') return end(200, readFileSync(join(root, 'public', asset[0])), asset[1]);
      if (!auth.valid(id)) {
        if (path === '/' && req.method === 'GET') { res.setHeader('Location', '/signin'); return end(303, 'Sign in', 'text/plain'); }
        return end(401, { error: 'Your session ended. Keep a copy of unsaved text, then reload and sign in again.' });
      }
      const data = mutation ? await readBody(req, 800000) : undefined;
      if (!liveEnabled) {
        const match = path.match(/^\/api\/runs\/([a-f0-9-]{36})\/(answer|combine)$/);
        const liveRun = match && backend.store.get(match[1]).mode === 'live';
        if (path.startsWith('/api/models/') || (path === '/api/runs' && data?.mode === 'live') ||
          (liveRun && (match[2] === 'answer' || data?.method === 'synthesize')))
          return end(403, { error: 'Live provider access is disabled by the server owner.' });
      }
      // Never forward browser cookies, authorization, Host, Origin or token headers.
      // The backend address and session token are private and fixed per process.
      const controller = new AbortController(); pending.add(controller);
      const abort = () => controller.abort(); res.once('close', abort);
      try {
        const response = await fetch(upstream + req.url, { method: req.method,
          headers: { 'Content-Type': 'application/json', 'X-Prism-Session': backend.token },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: controller.signal });
        if (path === '/api/config' && response.ok) {
          const config = await response.json();
          return end(200, { ...config, browserSession: true, liveEnabled, version: '0.3.1' });
        }
        return end(response.status, Buffer.from(await response.arrayBuffer()), response.headers.get('content-type') || 'application/octet-stream');
      } finally { pending.delete(controller); res.off('close', abort); }
    } catch (error) { end(error.status || 500, { error: error.status ? error.message : 'Browser server could not complete this request. Keep your unsaved text.' }); }
  });
  server.requestTimeout = 150000;
  server.headersTimeout = 15000;
  return { server, backend, async close() {
    closing = true; auth.clear(); for (const c of pending) c.abort();
    await new Promise(done => server.close(done)); await backend.close();
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const envFile = join(root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const run = async () => {
    const port = Number(process.env.PRISM_BROWSER_PORT || 8797);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error();
    const app = await createBrowserApp();
    app.server.once('error', async () => { await app.close(); console.error('Cannot start Prism browser access. Check port and configuration.'); process.exitCode = 1; });
    app.server.listen(port, '127.0.0.1', () => console.log('Prism browser sign-in: ' +
      (process.env.PRISM_BROWSER_ORIGIN || 'http://127.0.0.1:' + port) + '\nKeep this server running. No compilation is required.'));
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await app.close(); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  };
  run().catch(() => { console.error('Cannot start Prism browser access. Set a private password of at least 16 characters and check configuration.'); process.exitCode = 1; });
}
