import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const playwright = await import(process.env.PRISM_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.default || playwright;
const file = pathToFileURL(resolve('demo/Prism-demo.html')).href;
const output = resolve(process.env.PRISM_BROWSER_OUTPUT || 'work/html-demo');
await mkdir(output, { recursive: true });
for (const width of [1440, 412]) {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.PRISM_BROWSER_EXECUTABLE || undefined,
    args: JSON.parse(process.env.PRISM_BROWSER_ARGS || '["--no-sandbox","--disable-dev-shm-usage"]') });
  try {
    const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: width === 412, hasTouch: width === 412, acceptDownloads: true });
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
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(output, width + '-combined.png'), fullPage: true });
    assert.deepEqual(errors, []);
    assert.ok(requests.every(url => url.startsWith('file:')));
    console.log(width + 'px offline demo: compare, score, combine, save, export and reload passed with no network requests.');
  } finally { await browser.close(); }
}
