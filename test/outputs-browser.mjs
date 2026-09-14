import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createBrowserApp } from '../src/browser-server.mjs';
import { zipFiles } from '../src/zip.mjs';

const { chromium } = await import(process.env.PRISM_PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(process.env.PRISM_BROWSER_OUTPUT || 'work/outputs'); await mkdir(output, { recursive: true });
const launch = { headless: true, executablePath: process.env.PRISM_BROWSER_EXECUTABLE || undefined,
  args: JSON.parse(process.env.PRISM_BROWSER_ARGS || '["--no-sandbox","--disable-dev-shm-usage"]') };
const hostile = `<!doctype html><meta charset="utf-8"><h1>Isolation check</h1><output id="result"></output><button id="navigate">Try external navigation</button><script>
  const results={};try{parent.document.body.dataset.compromised='yes';results.parent='readable'}catch{results.parent='blocked'}
  try{localStorage.setItem('preview-test','bad');results.storage='readable'}catch{results.storage='blocked'}
  fetch('/api/config').then(()=>{results.network='readable'}).catch(()=>{results.network='blocked'}).finally(()=>document.getElementById('result').textContent=JSON.stringify(results));
  document.getElementById('navigate').onclick=()=>location.href='https://prism-output-test.invalid/no-egress';
  </script>`;

for (const width of [1440, 412]) {
  const directory = await mkdtemp(resolve(tmpdir(), 'prism-output-ui-'));
  const app = await createBrowserApp({ directory, env: { PRISM_BROWSER_PASSWORD: 'synthetic-output-test-password' }, fetcher: async () => { throw Error('No provider calls in browser tests'); } });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  const url = 'http://127.0.0.1:' + app.server.address().port;
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, acceptDownloads: true });
    page.setDefaultTimeout(12000);
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {
      const target = new URL(route.request().url());
      if (target.origin === url || ['blob:', 'data:'].includes(target.protocol)) return route.continue();
      external.push(target.href); return route.abort();
    });
    await page.goto(url);
    await page.locator('#password').fill('synthetic-output-test-password'); await page.locator('#submit').click();
    await page.getByRole('button', { name: /Try an example/ }).click();
    await page.getByRole('button', { name: /Compare answers/ }).click();
    await page.waitForFunction(() => document.getElementById('answer-count')?.textContent === '4/4' && document.getElementById('stop-button').hidden);
    assert.equal(await page.locator('#answer-grid .output-item').count(), 4);
    await page.getByRole('button', { name: 'Inspect tiny-counter.html', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Inspect output' });
    assert.match(await dialog.locator('pre').innerText(), /window.counter=0/);
    await dialog.getByRole('button', { name: 'Run preview', exact: true }).click();
    let frame = page.frameLocator('.output-preview iframe');
    await frame.getByRole('button', { name: 'Add one' }).click();
    await frame.getByRole('button', { name: 'Add one' }).click();
    assert.equal(await frame.locator('#count').innerText(), '2');
    assert.equal(await dialog.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    await page.screenshot({ path: resolve(output, width + '-app-preview.png'), fullPage: false });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect comparison-map.svg', exact: true }).click();
    await dialog.locator('img').evaluate(img => img.decode());
    assert.ok(await dialog.locator('img').evaluate(img => img.naturalWidth > 0));
    await page.screenshot({ path: resolve(output, width + '-image-preview.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download review-template.csv', exact: true }).click();
    const downloaded = await download;
    assert.equal(await readFile(await downloaded.path(), 'utf8'), 'answer,accuracy,usefulness,clarity\nA,,,\nB,,,\nC,,,\nD,,,\n');
    const uploaded = page.waitForResponse(r => r.url().endsWith('/artifacts') && r.request().method() === 'POST');
    await page.locator('[data-attach="openai"]').setInputFiles([{ name: 'isolation-check.html', mimeType: 'text/html', buffer: Buffer.from(hostile) },
      { name: 'opaque-output.dat', mimeType: 'application/octet-stream', buffer: Buffer.alloc(900000, 42) },
      { name: 'evidence.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% browser fixture\n%%EOF') },
      { name: 'candidate-app.zip', mimeType: 'application/zip', buffer: zipFiles([
        ['index.html', '<main id="app"></main><script src="src/app.js"></script>'],
        ['src/app.js', 'document.querySelector("#app").textContent="Bundle ready";'],
        ['assets/data.bin', Buffer.from([0, 1, 2, 3])],
      ]) }]);
    assert.equal((await uploaded).status(), 201);
    await page.getByRole('button', { name: 'Inspect candidate-app.zip', exact: true }).click();
    assert.match(await dialog.innerText(), /3 files/);
    assert.match(await dialog.innerText(), /Nothing was extracted or executed/);
    assert.match(await dialog.innerText(), /src\/app\.js/);
    await page.screenshot({ path: resolve(output, width + '-app-bundle-manifest.png'), fullPage: false });
    await dialog.getByRole('button', { name: 'Run preview', exact: true }).click();
    frame = page.frameLocator('.output-preview iframe');
    assert.equal(await frame.locator('#app').innerText(), 'Bundle ready');
    assert.equal(await dialog.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    await page.screenshot({ path: resolve(output, width + '-app-bundle-preview.png'), fullPage: false });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect opaque-output.dat', exact: true }).click();
    assert.match(await dialog.innerText(), /Original attachment preserved/);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect isolation-check.html', exact: true }).click();
    await dialog.getByRole('button', { name: 'Run preview', exact: true }).click();
    frame = page.frameLocator('.output-preview iframe');
    await frame.locator('#result').filter({ hasText: 'network' }).waitFor();
    assert.deepEqual(JSON.parse(await frame.locator('#result').innerText()), { parent: 'blocked', storage: 'blocked', network: 'blocked' });
    const navigationBlocked = page.waitForEvent('console', { predicate: msg => msg.text().includes("frame-src 'self'") });
    await frame.getByRole('button', { name: 'Try external navigation' }).click();
    await navigationBlocked;
    assert.equal(page.url(), url + '/'); assert.deepEqual(external, []);
    assert.equal(await page.locator('body').getAttribute('data-compromised'), null);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const reviewSaved = page.waitForResponse(r => r.url().endsWith('/review') && r.status() === 200);
    await page.locator('#answer-grid [data-select="openai"]').check();
    await reviewSaved;
    await page.getByRole('tab', { name: 'Combined answer', exact: true }).click();
    await page.locator('.payload-preview summary').click();
    await page.locator('#synthesis-preview').filter({ hasText: 'metadata-only' }).waitFor();
    assert.ok(!(await page.locator('#synthesis-preview').innerText()).includes('window.counter=0'));
    await page.locator('#include-readable-files').check();
    await page.locator('#synthesis-preview').filter({ hasText: 'window.counter=0' }).waitFor();
    const synthesisPreview = await page.locator('#synthesis-preview').innerText();
    assert.match(synthesisPreview, /Isolation check/);
    assert.match(synthesisPreview, /binary or unsupported type/);
    assert.equal(await page.locator('#include-app-sources').isEnabled(), true);
    await page.locator('#include-app-sources').check();
    await page.locator('#synthesis-preview').filter({ hasText: 'bounded-readable-project-sources' }).waitFor();
    const appPreview = await page.locator('#synthesis-preview').innerText();
    assert.match(appPreview, /Bundle ready/);
    assert.ok(!appPreview.includes('UEsDB'));
    assert.equal(await page.locator('#include-pdfs').isEnabled(), true);
    await page.locator('#include-pdfs').check();
    await page.locator('#synthesis-preview').filter({ hasText: 'bounded-inline-pdfs' }).waitFor();
    const documentPreview = await page.locator('#synthesis-preview').innerText();
    assert.match(documentPreview, /evidence\.pdf/);
    assert.ok(!documentPreview.includes(Buffer.from('%PDF-1.4\n% browser fixture\n%%EOF').toString('base64')));
    await page.screenshot({ path: resolve(output, width + '-synthesis-payload.png'), fullPage: true });
    await page.locator('#synthesize-button').click();
    await page.waitForFunction(() => document.querySelectorAll('#combined-files .output-item').length === 5);
    assert.match(await page.locator('#combined-meta').innerText(), /readable file contents used/);
    assert.match(await page.locator('#combined-meta').innerText(), /app source inspected/);
    assert.match(await page.locator('#combined-meta').innerText(), /PDFs inspected/);
    const zipDownload = page.waitForEvent('download'); await page.locator('#export-zip').click();
    assert.ok((await zipDownload).suggestedFilename().endsWith('.zip'));
    await page.reload();
    await page.getByRole('tab', { name: 'Combined answer', exact: true }).click();
    assert.equal(await page.locator('#combined-files .output-item').count(), 5);
    await page.locator('#new-comparison').click();
    await page.locator('.advanced > summary').click();
    await page.locator('#output-mode').selectOption('visual');
    assert.equal(await page.locator('[data-provider-pick="grok"]').isDisabled(), true);
    assert.equal(await page.locator('[data-provider-pick="claude"]').isDisabled(), true);
    assert.match(await page.locator('#send-caption').innerText(), /2 models · generated image/);
    await page.locator('#prompt').fill('Create one calm visual and briefly explain the design choice.');
    await page.locator('#send-button').click();
    await page.waitForFunction(() => document.getElementById('answer-count')?.textContent === '2/2' && document.getElementById('stop-button').hidden);
    assert.equal(await page.locator('#answer-grid .output-item').count(), 2);
    assert.match(await page.locator('#session-note').innerText(), /Requested generated image/);
    for (const provider of ['openai', 'gemini']) {
      const saved = page.waitForResponse(r => r.url().endsWith('/review') && r.status() === 200);
      await page.locator('#answer-grid [data-select="' + provider + '"]').check();
      await saved;
    }
    await page.getByRole('tab', { name: 'Combined answer', exact: true }).click();
    await page.locator('.payload-preview summary').click();
    assert.equal(await page.locator('#include-images').isEnabled(), true);
    await page.locator('#include-images').check();
    await page.locator('#synthesis-preview').filter({ hasText: 'bounded-inline-images' }).waitFor();
    const visualPreview = await page.locator('#synthesis-preview').innerText();
    assert.match(visualPreview, /openai-visual-sample\.png/);
    assert.match(visualPreview, /gemini-visual-sample\.png/);
    assert.ok(!visualPreview.includes('iVBORw0KGgo'));
    await page.locator('#synthesize-button').click();
    await page.locator('#combined-meta').filter({ hasText: 'images visually inspected' }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(output, width + '-visual-output-mode.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(width + 'px: image preview, interactive single-file and ZIP apps, isolated scripts, app-bundle manifest/source synthesis, exact downloads, attachment upload, combined files, visual synthesis, ZIP and reload passed.');
  } finally { await browser.close(); await app.close(); await rm(directory, { recursive: true, force: true }); }
}
