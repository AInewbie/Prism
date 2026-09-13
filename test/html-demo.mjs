import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const playwright = await import(process.env.PRISM_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.default || playwright;
const file = pathToFileURL(resolve('demo/Prism-demo.html')).href;
const output = resolve(process.env.PRISM_BROWSER_OUTPUT || 'work/html-demo');
await mkdir(output, { recursive: true });
for (const width of [1440, 412]) {
  const profile = await mkdtemp(resolve(tmpdir(), 'prism-offline-browser-'));
  const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width, height: 950 }, isMobile: width === 412, hasTouch: width === 412, acceptDownloads: true,
    executablePath: process.env.PRISM_BROWSER_EXECUTABLE || undefined,
    args: JSON.parse(process.env.PRISM_BROWSER_ARGS || '["--no-sandbox","--disable-dev-shm-usage"]') });
  try {
    const page = await context.newPage(), requests = [], errors = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(file);
    await page.getByRole('button', { name: /Compare sample answers/ }).click();
    assert.equal(await page.locator('.card').count(), 4);
    const first = page.locator('.card').first();
    await first.getByRole('button', { name: /accuracy 4/i }).click();
    await first.getByRole('button', { name: /usefulness 5/i }).click();
    await first.getByRole('button', { name: /clarity 4/i }).click();
    assert.equal(await first.locator('.overall').innerText(), '4.3/5');
    await page.locator('[data-select]').nth(0).check(); await page.locator('[data-select]').nth(1).check();
    await page.getByRole('button', { name: 'Combined answer', exact: true }).click();
    await page.getByRole('button', { name: /Assemble editable draft/ }).click();
    assert.match(await page.locator('#draft').inputValue(), /Combined working draft/);
    await page.locator('#draft').fill('My saved combined answer.');
    await page.getByRole('button', { name: 'Save draft' }).click();
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export JSON' }).click(); await download;
    await page.reload();
    await page.getByRole('button', { name: 'Combined answer', exact: true }).click();
    assert.equal(await page.locator('#draft').inputValue(), 'My saved combined answer.');
    await page.getByRole('button', { name: /New comparison/ }).click();
    await page.locator('#prompt').fill('Café launch plan');
    await page.getByRole('button', { name: /Compare sample answers/ }).click();
    await page.keyboard.press('Control+k');
    assert.equal(await page.locator('#session-search').evaluate(e => document.activeElement === e), true);
    await page.locator('#session-search').fill('CAFE');
    assert.equal(await page.locator('#history [data-load]').count(), 1);
    await page.locator('#session-search').fill('no-match');
    assert.equal(await page.locator('#history [data-load]').count(), 0);
    await page.locator('#clear-session-search').click();
    assert.equal(await page.locator('#history [data-load]').count(), 2);
    await page.locator('#session-search').fill('useful app');
    await page.locator('#history [data-load]').click();
    await page.getByRole('button', { name: 'Combined answer', exact: true }).click();
    assert.equal(await page.locator('#draft').inputValue(), 'My saved combined answer.');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(output, width + '-combined.png'), fullPage: true });
    assert.deepEqual(errors, []);
    assert.ok(requests.every(url => url.startsWith('file:')));
    console.log(width + 'px offline demo: compare, score, combine, save, export, reload and searchable history passed with no network requests.');
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
}
