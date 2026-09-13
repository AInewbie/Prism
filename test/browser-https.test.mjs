import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpsBrowserFixture } from './helpers/https-proxy.mjs';

test('real TLS proxy preserves authentication, origin controls and saved demo work', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'prism-https-data-'));
  let fixture;
  t.after(async () => {
    try { if (fixture) await fixture.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  let providerCalls = 0;
  const password = 'synthetic-https-test-passphrase';
  fixture = await createHttpsBrowserFixture({ directory,
    env: { PRISM_BROWSER_PASSWORD: password },
    fetcher: async () => { providerCalls++; throw Error('No real providers in TLS test'); } });
  const call = (path, { method = 'GET', body, cookie, headers = {}, trust = true } = {}) => new Promise((resolve, reject) => {
    // Keep TLS identity bound to the fixture IP even in the forged HTTP Host case.
    const req = request(fixture.url + path, { method, agent: false, servername: '',
      ...(trust ? { ca: fixture.certificate } : {}),
      headers: { ...(body ? { Origin: fixture.url, 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...headers } }, res => {
      const tls = { authorized: res.socket.authorized, protocol: res.socket.getProtocol() };
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, tls,
        text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  // Trust only this temporary certificate; never disable Node TLS verification.
  await assert.rejects(call('/signin', { trust: false }), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  const signin = await call('/signin');
  assert.equal(signin.status, 200); assert.equal(signin.tls.authorized, true);
  assert.match(signin.tls.protocol, /^TLSv1\.[23]$/);
  assert.equal((await call('/api/config')).status, 401);
  const login = await call('/api/auth/login', { method: 'POST', body: { password } });
  assert.equal(login.status, 200);
  const setCookie = login.headers['set-cookie'][0], cookie = setCookie.split(';')[0];
  assert.match(setCookie, /^__Host-prism-browser=/);
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(setCookie.includes(flag));
  assert.ok(!setCookie.includes('Domain='));
  const config = await call('/api/config', { cookie });
  assert.equal(config.status, 200); assert.equal(JSON.parse(config.text).liveEnabled, false);
  assert.equal((await call('/api/auth/logout', { method: 'POST', cookie, body: {}, headers: { Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await call('/api/config', { cookie, headers: { Host: 'foreign.example', 'X-Forwarded-Host': new URL(fixture.url).host } })).status, 403);
  const created = await call('/api/runs', { method: 'POST', cookie,
    body: { prompt: 'TLS synthetic comparison', providers: ['openai'], mode: 'demo' } });
  assert.equal(created.status, 201); const id = JSON.parse(created.text).run.id;
  assert.equal((await call('/api/runs/' + id + '/answer', { method: 'POST', cookie, body: { provider: 'openai' } })).status, 200);
  const exported = await call('/api/runs/' + id + '/export', { cookie });
  assert.equal(JSON.parse(exported.text).run.responses[0].status, 'complete');
  assert.equal((await call('/api/auth/logout', { method: 'POST', cookie, body: {} })).status, 200);
  assert.equal((await call('/api/config', { cookie })).status, 401);
  assert.equal(providerCalls, 0);
});
