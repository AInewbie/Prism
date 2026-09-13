import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createBrowserApp } from "../src/browser-server.mjs";
import { makeRun } from "../src/core.mjs";

const { chromium } = await import(process.env.PRISM_PLAYWRIGHT_MODULE || "playwright");
const output = resolve(process.env.PRISM_BROWSER_OUTPUT || "work/session-search");
await mkdir(output, {recursive: true});
for (const width of [1440, 412]) {
  const directory = await mkdtemp(resolve(tmpdir(), "prism-session-search-"));
  let providerCalls = 0;
  const password = "synthetic-session-search-test";
  const app = await createBrowserApp({directory, env: {PRISM_BROWSER_PASSWORD: password},
    fetcher: async () => {providerCalls++; throw Error("No provider calls permitted.");}});
  const store = app.backend?.store || app.store;
  // Synthetic records are seeded directly; the Live label is tested without making a paid request.
  for (const [prompt, mode] of [["Café launch plan", "demo"], ["Launch a café: costs", "live"], ["Research brief <img src=x onerror=alert(1)>", "demo"]]) {
    const run = makeRun({prompt, mode:"demo",providers:["openai"],maxTokens:256}, {});
    run.mode = mode;
    store.add(run);
  }
  await new Promise(done => app.server.listen(0, "127.0.0.1", done));
  const url = "http://127.0.0.1:" + app.server.address().port;
  const browser = await chromium.launch({headless:true,
    executablePath:process.env.PRISM_BROWSER_EXECUTABLE || undefined,
    args:JSON.parse(process.env.PRISM_BROWSER_ARGS || '["--no-sandbox","--disable-dev-shm-usage"]')});
  try {
    const page = await browser.newPage({viewport:{width,height:950},isMobile:width===412,hasTouch:width===412});
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    await page.goto(url);
    await page.locator("#password").fill(password);
    await page.locator("#submit").click();
    await page.waitForFunction(() => document.getElementById("session-result-count")?.textContent === "3 of 3 sessions");
    await page.locator("#prompt").fill("Keep my unfinished prompt");
    await page.keyboard.press("Control+k");
    assert.equal(await page.locator("#session-search").evaluate(e => document.activeElement===e),true);
    await page.locator("#session-search").fill("CAFE launch");
    assert.equal(await page.locator(".history-item").count(),2);
    await page.locator("#session-mode").selectOption("live");
    assert.equal(await page.locator(".history-item").count(),1);
    assert.equal(await page.locator("#session-result-count").innerText(),"1 of 3 sessions");
    await page.locator("#session-search").fill("no-match");
    assert.equal(await page.locator(".history-item").count(),0);
    assert.match(await page.locator("#history-list").innerText(),/No sessions match/);
    await page.locator("#clear-session-search").click();
    assert.equal(await page.locator(".history-item").count(),3);
    assert.equal(await page.locator("#prompt").inputValue(),"Keep my unfinished prompt");
    assert.equal(await page.locator("#history-list img").count(),0);
    await page.locator("#session-search").fill("cafe");
    await page.locator("#session-mode").selectOption("demo");
    await page.locator(".history-item").click();
    await page.locator("#session").waitFor({state:"visible"});
    assert.match(await page.locator("#session").innerText(),/Café launch plan/);
    assert.equal(await page.locator("#session-search").inputValue(),"cafe");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors,[]); assert.equal(providerCalls,0);
    await page.screenshot({path:resolve(output,width+"-session-search.png"),fullPage:true});
    console.log(width+"px session search passed: login, accented search, combined mode filters, empty/reset, keyboard focus, safe text, reopen, no provider calls.");
  } finally {await browser.close(); await app.close(); await rm(directory,{recursive:true,force:true});}
}
