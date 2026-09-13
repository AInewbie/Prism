import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { createBrowserApp } from '../src/browser-server.mjs';
import { browserSessions, browserOrigin, SESSION_SECONDS } from '../src/browser-session.mjs';
const password = 'synthetic-browser-test-passphrase';
async function fixture(t, options = {}) {
  const directory = mkdtempSync(tmpdir() + '/prism-browser-access-');
  const app = await createBrowserApp({ directory, env: { PRISM_BROWSER_PASSWORD: password }, ...options });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + app.server.address().port;
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  // Node fetch rewrites Host; use raw HTTP for actual Host-boundary assertions.
  const call = (path, { method = 'GET', data, cookie, headers = {} } = {}) => new Promise((done, reject) => {
    const req = request(url + path, { method, headers: {
      ...(method === 'GET' ? {} : { Origin: url, 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}), ...headers,
    } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => done(new Response(Buffer.concat(chunks), { status: res.statusCode,
        headers: Object.fromEntries(Object.entries(res.headers).map(([k,v]) => [k, Array.isArray(v) ? v.join(', ') : v])) })));
    });
    req.on('error', reject); req.end(data === undefined ? undefined : JSON.stringify(data));
  });
  return { app, url, call };
}
test('browser login protects data, sets HttpOnly cookie and revokes it on logout', async t => {
  const { app, call } = await fixture(t);
  assert.equal((await call('/')).status, 303);
  assert.equal((await call('/api/config')).status, 401);
  assert.equal((await call('/signin')).status, 200);
  assert.equal((await call('/api/auth/login', { method: 'POST', data: { password: 'wrong' } })).status, 401);
  const login = await call('/api/auth/login', { method: 'POST', data: { password } });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie'), cookie = setCookie.split(';')[0];
  assert.match(setCookie, /HttpOnly; SameSite=Strict/);
  assert.ok(!(await login.text()).includes(cookie.split('=')[1]));
  const config = await call('/api/config', { cookie });
  assert.equal(config.status, 200); const data = await config.json();
  assert.equal(data.browserSession, true); assert.equal(data.liveEnabled, false);
  assert.ok(!JSON.stringify(data).includes(app.backend.token));
  const created = await call('/api/runs', { method: 'POST', cookie, data: { prompt: 'Synthetic', providers: ['openai'], mode: 'demo' } });
  assert.equal(created.status, 201); const id = (await created.json()).run.id;
  assert.equal((await call('/api/runs/' + id + '/answer', { method: 'POST', cookie, data: { provider: 'openai' } })).status, 200);
  const exported = await call('/api/runs/' + id + '/export', { cookie });
  assert.match(exported.headers.get('content-type'), /application\/json/);
  assert.equal((await exported.json()).run.responses[0].status, 'complete');
  assert.equal((await call('/api/auth/logout', { method: 'POST', cookie, data: {} })).status, 200);
  assert.equal((await call('/api/config', { cookie })).status, 401);
});
test('browser access rejects foreign/missing origins, untrusted hosts and forged auth', async t => {
  const { call, app } = await fixture(t);
  const args = { method: 'POST', data: { password } };
  assert.equal((await call('/api/auth/login', { ...args, headers: { Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await call('/api/auth/login', { ...args, headers: { Origin: '' } })).status, 403);
  assert.equal((await call('/api/auth/login', { ...args, headers: { Host: 'foreign.example' } })).status, 403);
  assert.equal((await call('/api/config', { headers: { 'X-Prism-Session': app.backend.token, Cookie: 'prism-browser-local=' + 'a'.repeat(64) } })).status, 401);
  const login = await call('/api/auth/login', args), cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/config', { cookie: cookie + '; ' + cookie })).status, 401);
  assert.equal((await call('/api/runs', { method: 'POST', cookie, data: {}, headers: { Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await call('/api/auth/logout', { method: 'POST', cookie, data: {}, headers: { Origin: '' } })).status, 403);
  assert.equal((await call('/api/config', { cookie })).status, 200);
});
test('browser sessions expire, login attempts are bounded, and invalid config fails closed', async () => {
  let time = 0; const auth = browserSessions(password, { now: () => time });
  const signedIn = await auth.login(password); assert.ok(auth.valid(signedIn.id));
  for (let i = 0; i < 4; i++) assert.equal((await auth.login('wrong')).status, 401);
  assert.equal((await auth.login(password)).status, 429);
  time += 60001; assert.equal((await auth.login(password)).status, 200);
  time += SESSION_SECONDS * 1000; assert.equal(auth.valid(signedIn.id), false);
  assert.throws(() => browserSessions('short'));
  assert.throws(() => browserOrigin('http://public.example'));
  assert.throws(() => browserOrigin('https://user:pass@public.example'));
  assert.throws(() => browserOrigin('https://public.example/path'));
});
test('configured HTTPS origin uses Secure host-only cookies and ignores forwarded headers', async t => {
  const origin = 'https://prism.example';
  const { call } = await fixture(t, { env: { PRISM_BROWSER_PASSWORD: password, PRISM_BROWSER_ORIGIN: origin } });
  assert.equal((await call('/signin', { headers: { 'X-Forwarded-Host': 'prism.example', 'X-Forwarded-Proto': 'https' } })).status, 403);
  const result = await call('/api/auth/login', { method: 'POST', data: { password }, headers: { Host: 'prism.example', Origin: origin } });
  assert.equal(result.status, 200);
  const cookie = result.headers.get('set-cookie');
  assert.match(cookie, /^__Host-prism-browser=/); assert.match(cookie, /; Secure$/); assert.ok(!cookie.includes('Domain='));
});
test('live browser calls are disabled by default and restart requires reauthentication', async t => {
  let calls = 0; const { app, call } = await fixture(t, { fetcher: async () => { calls++; throw Error('No providers'); } });
  const login = await call('/api/auth/login', { method: 'POST', data: { password } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/runs', { method: 'POST', cookie, data: { prompt: 'No spending', providers: ['openai'], mode: 'live' } })).status, 403);
  assert.equal((await call('/api/models/openai', { method: 'POST', cookie, data: {} })).status, 403);
  assert.equal(calls, 0);
  const directory = app.backend.store.directory;
  await app.close();
  const next = await createBrowserApp({ directory, env: { PRISM_BROWSER_PASSWORD: password } });
  await new Promise(r => next.server.listen(0, '127.0.0.1', r));
  const response = await fetch('http://127.0.0.1:' + next.server.address().port + '/api/config', { headers: { Cookie: cookie } });
  assert.equal(response.status, 401); await next.close();
});
test('explicitly enabled browser calls reach the fixture provider and preserve synthesis', async t => {
  let calls = 0;
  const { call } = await fixture(t, { env: { PRISM_BROWSER_PASSWORD: password, PRISM_BROWSER_ALLOW_LIVE: '1' },
    fetcher: async () => { calls++; return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Synthetic provider answer' }] }] }); } });
  const login = await call('/api/auth/login', { method: 'POST', data: { password } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const request = (path, data, method = 'POST') => call(path, { method, cookie, data });
  assert.equal((await request('/api/connections/openai', { key: 'synthetic-private-key', model: 'fixture-model', remember: false }, 'PUT')).status, 200);
  const created = await request('/api/runs', { mode: 'live', prompt: 'Synthetic only', providers: ['openai'] });
  const id = (await created.json()).run.id;
  assert.equal((await request('/api/runs/' + id + '/answer', { provider: 'openai' })).status, 200);
  const combined = await request('/api/runs/' + id + '/combine', { providers: ['openai'], method: 'synthesize', provider: 'openai', version: 0 });
  assert.equal(combined.status, 200); const body = await combined.json();
  assert.equal(body.run.combined.text, 'Synthetic provider answer');
  assert.equal(calls, 2); assert.ok(!JSON.stringify(body).includes('synthetic-private-key'));
});
