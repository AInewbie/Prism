// Disposable loopback-only TLS test fixture, never a production proxy.
import { createServer } from 'node:https';
import { request } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, X509Certificate } from 'node:crypto';
import { createBrowserApp } from '../../src/browser-server.mjs';

const execute = promisify(execFile);
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

export async function createHttpsBrowserFixture(options = {}) {
  const temporary = await mkdtemp(join(tmpdir(), 'prism-test-tls-'));
  let proxy, app, closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    if (proxy) {
      const stopped = new Promise(resolve => proxy.close(resolve));
      proxy.closeAllConnections(); await stopped;
    }
    try { if (app) await app.close(); }
    finally { await rm(temporary, { recursive: true, force: true }); }
  };
  try {
    const keyPath = join(temporary, 'key.pem'), certPath = join(temporary, 'cert.pem');
    // Keys are generated per run inside a private temporary directory and deleted.
    await execute('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1'], { timeout: 30000 });
    const certificate = await readFile(certPath);
    const spki = createHash('sha256').update(new X509Certificate(certificate).publicKey
      .export({ type: 'spki', format: 'der' })).digest('base64');
    proxy = createServer({ key: await readFile(keyPath), cert: certificate, minVersion: 'TLSv1.2' }, (req, res) => {
      if (!app) { res.writeHead(503); res.end(); return; }
      const upstream = request({ hostname: '127.0.0.1', port: app.server.address().port,
        path: req.url, method: req.method, headers: req.headers }, reply => {
        res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => upstream.destroy());
      req.pipe(upstream);
    });
    await listen(proxy);
    const url = 'https://127.0.0.1:' + proxy.address().port;
    app = await createBrowserApp({ ...options, directory: options.directory || join(temporary, 'workspace'),
      env: { ...options.env, PRISM_BROWSER_ORIGIN: url } });
    await listen(app.server);
    return { app, url, certificate, spki, close };
  } catch (error) { await close(); throw error; }
}
