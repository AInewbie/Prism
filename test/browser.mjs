import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createApp } from "../src/server.mjs";
import { createBrowserApp } from "../src/browser-server.mjs";
import { createHttpsBrowserFixture } from "./helpers/https-proxy.mjs";

const playwright = await import(
  process.env.PRISM_PLAYWRIGHT_MODULE || "playwright"
);
const { chromium } = playwright.default || playwright;
const directory = await mkdtemp(resolve(tmpdir(), "prism-browser-"));
const output = resolve(process.env.PRISM_BROWSER_OUTPUT || "work/browser");
await mkdir(output, { recursive: true });
let providerCalls = 0;
const httpsAccess = process.argv.includes('--https') || process.env.PRISM_TEST_BROWSER_HTTPS === "1";
const browserAccess = httpsAccess || process.env.PRISM_TEST_BROWSER_GATEWAY === "1";
const password = "synthetic-browser-test-passphrase";
const appOptions = {
  directory,
  env: browserAccess ? { PRISM_BROWSER_PASSWORD: password } : {},
  fetcher: async () => {
    providerCalls++;
    throw Error("No real provider calls allowed in browser test.");
  },
};
const tlsFixture = httpsAccess ? await createHttpsBrowserFixture(appOptions) : null;
const app = tlsFixture?.app || await (browserAccess ? createBrowserApp : createApp)(appOptions);
if (!tlsFixture) await new Promise((done) => app.server.listen(0, "127.0.0.1", done));
const url = tlsFixture?.url ||
  "http://127.0.0.1:" + app.server.address().port + (browserAccess ? "/" : "/#key=" + app.token);
const launchOptions = {
  headless: true,
  ...(process.env.PRISM_BROWSER_EXECUTABLE
    ? { executablePath: process.env.PRISM_BROWSER_EXECUTABLE }
    : {}),
  args: process.env.PRISM_BROWSER_ARGS
    ? JSON.parse(process.env.PRISM_BROWSER_ARGS)
    : ["--no-sandbox", "--disable-dev-shm-usage"],
};
// Trust only the disposable fixture key, never all HTTPS certificates.
if (tlsFixture) launchOptions.args.push('--ignore-certificate-errors-spki-list=' + tlsFixture.spki);
let browser = await chromium.launch(launchOptions);
try {
  for (const width of [1600, 412]) {
    if (browserAccess && width === 412) {
      // Isolate cookie jars in single-process Chromium distributions as well.
      await browser.close(); browser = await chromium.launch(launchOptions);
    }
    const context = await browser.newContext({
      viewport: { width, height: 1050 },
      isMobile: width === 412,
      hasTouch: width === 412,
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(12000);
    await page.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      return host === "127.0.0.1" ? route.continue() : route.abort();
    });
    await page.goto(url);
    if (browserAccess) {
      await page.locator('#password').fill(password);
      await page.screenshot({ path: resolve(output, width + '-signin.png'), fullPage: true });
      const signedIn = page.waitForResponse(r => r.url().endsWith('/api/auth/login'));
      await page.locator('#submit').click();
      const loginResponse = await signedIn;
      assert.equal(loginResponse.status(), 200);
      if (httpsAccess) {
        assert.equal(new URL(page.url()).protocol, 'https:');
        const cookie = (await context.cookies()).find(c => c.name === '__Host-prism-browser');
        assert.ok(cookie); assert.equal(cookie.secure, true);
        assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'Strict');
      }
    }
    await page.locator("#provider-picker .provider-chip").first().waitFor({ state: 'attached' }).catch(async error => {
      console.error('Initial page state:', page.url(), (await page.locator('body').innerText()).slice(0,1800), errors, (await context.cookies()).map(c => ({name:c.name,domain:c.domain,secure:c.secure,sameSite:c.sameSite})));
      throw error;
    });
    await page.waitForLoadState("networkidle");
    if (await page.locator("#session").isVisible())
      await page
        .getByRole("button", { name: "New comparison", exact: false })
        .click();
    await page.locator("#composer").waitFor({ state: "visible" });
    await page.screenshot({
      path: resolve(output, width + "-home.png"),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page
      .getByRole("button", { name: "Try an example", exact: false })
      .click();
    await page
      .getByRole("button", { name: "Compare answers", exact: false })
      .click();
    await page.locator("#session").waitFor({ state: "visible" });
    await page.waitForFunction(
      () => document.getElementById("answer-count").textContent === "4/4",
    );
    await page.waitForFunction(
      () => document.getElementById("stop-button").hidden,
    );
    assert.equal(await page.locator(".answer-card").count(), 4);
    assert.equal(await page.locator(".answer-text").count(), 4);
    const a = page.getByRole("article", { name: "Answer A", exact: true });
    for (const [criterion, n] of [
      ["Accuracy", 4],
      ["Usefulness", 5],
      ["Clarity", 4],
    ]) {
      const option = a.getByRole("radio", {
        name: criterion + " " + n + " of 5 for answer A",
        exact: true,
      });
      await option.click();
      await page.waitForFunction(
        ({ criterion, n }) =>
          document
            .querySelector(
              '[aria-label="' + criterion + " " + n + ' of 5 for answer A"]',
            )
            ?.getAttribute("aria-checked") === "true",
        { criterion, n },
      );
    }
    assert.equal(await a.locator(".score-badge").innerText(), "4.3/5");
    await a
      .getByRole("textbox", { name: "Notes for answer A", exact: true })
      .fill("Keep the practical steps; verify assumptions.");
    await a
      .getByRole("textbox", { name: "Notes for answer A", exact: true })
      .press("Tab");
    await page.waitForFunction(
      () => document.getElementById("new-comparison").disabled === false,
    );
    await a
      .getByRole("checkbox", { name: "Use in combined answer", exact: true })
      .check();
    await page.waitForFunction(() =>
      document
        .querySelector('article[aria-label="Answer A"]')
        .classList.contains("selected"),
    );
    const b = page.getByRole("article", { name: "Answer B", exact: true });
    await b
      .getByRole("checkbox", { name: "Use in combined answer", exact: true })
      .check();
    await page.waitForFunction(
      () =>
        document.getElementById("selected-count").textContent === "2 answers",
    );
    await page.locator("#blind").check();
    assert.equal(
      await a.getByRole("heading", { name: "Answer A", exact: true }).count(),
      1,
    );
    assert.ok(
      !(await page.locator("#answer-grid").innerText()).includes("ChatGPT"),
    );
    await page.locator("#blind").uncheck();
    await page.getByRole("tab", { name: "Scorecard", exact: true }).click();
    assert.ok(
      (await page.locator("#scorecard-view").innerText()).includes("4.3"),
    );
    await page.getByRole("tab", { name: /^Answers/ }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(output, width + "-comparison.png"),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page
      .getByRole("button", { name: "Combine selected", exact: false })
      .click();
    await page
      .getByRole("button", { name: "Assemble editable draft", exact: false })
      .click();
    await page.waitForFunction(() =>
      document
        .getElementById("combined-text")
        .value.includes("Combined working draft"),
    );
    assert.ok(
      (await page.locator("#combined-text").inputValue()).includes(
        "Keep the practical steps",
      ),
    );
    await page
      .locator("#combined-text")
      .fill("My final answer, combining the two selected perspectives.");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.getElementById("combined-save-state").textContent ===
        "Saved locally",
    );
    await page.locator("#draft-history summary").click();
    await page.locator("#combined-text").fill("Unsaved typing must not be lost");
    assert.equal(await page.locator("#restore-draft").isDisabled(), true);
    await page.locator("#combined-text").fill("My final answer, combining the two selected perspectives.");
    await page.locator("#compile-button").click();
    await page.waitForFunction(() => document.getElementById("combined-text").value.includes("Combined working draft"));
    await page.locator("#history-select").selectOption({ label: "Revision 2 · Editable compilation" });
    assert.equal(await page.locator("#history-preview").inputValue(), "My final answer, combining the two selected perspectives.");
    await page.locator("#restore-draft").click();
    await page.waitForFunction(() => document.getElementById("combined-text").value === "My final answer, combining the two selected perspectives.");
    assert.equal(await page.locator("#history-select option").count(), 3);
    assert.equal(await page.locator("#draft-revision-count").textContent(), "3 saved revisions");
    assert.ok(await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
      return new Set(ids).size === ids.length;
    }));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: resolve(output, width + "-combined.png"),
      fullPage: true,
    });
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export JSON", exact: true })
      .click();
    const download = await downloadPromise;
    const downloaded = JSON.parse(
      await readFile(await download.path(), "utf8"),
    );
    assert.equal(
      downloaded.run.combined.text,
      "My final answer, combining the two selected perspectives.",
    );
    assert.equal(downloaded.run.combinedHistory.length, 3);
    assert.equal(downloaded.run.combined.restoredFrom, 2);
    assert.equal(
      downloaded.run.responses.find((r) => r.label === "A").scores.usefulness,
      5,
    );
    assert.equal(
      downloaded.run.responses.find((r) => r.label === "A").notes,
      "Keep the practical steps; verify assumptions.",
    );
    assert.equal(downloaded.run.responses.filter((r) => r.selected).length, 2);
    assert.equal(
      downloaded.run.responses.filter((r) => r.status === "complete").length,
      4,
    );
    await page.reload();
    await page
      .getByRole("tab", { name: "Combined answer", exact: true })
      .click();
    assert.equal(
      await page.locator("#combined-text").inputValue(),
      "My final answer, combining the two selected perspectives.",
    );
    await page
      .getByRole("button", { name: /^Connections/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#key-openai").fill("synthetic-browser-key");
    await dialog.locator("#model-openai").fill("fixture-model");
    await dialog
      .locator('[data-connect="openai"]')
      .getByRole("button", { name: "Save connection", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .getElementById("status-openai")
        .textContent.includes("Connection saved"),
    );
    assert.equal(await dialog.locator("#key-openai").inputValue(), "");
    assert.ok(
      !(
        await page.evaluate(() =>
          JSON.stringify({ ...localStorage, ...sessionStorage }),
        )
      ).includes("synthetic-browser-key"),
    );
    assert.ok(
      !(await readFile(resolve(directory, "workspace.json"), "utf8")).includes(
        "synthetic-browser-key",
      ),
    );
    await page.keyboard.press("Escape");
    if (browserAccess) {
      assert.equal(new URL(page.url()).hash, '');
      assert.ok(!(await page.evaluate(() => document.cookie)).includes('prism-browser'));
      assert.equal(await page.evaluate(() => sessionStorage.getItem('prism-session')), null);
      await page.locator('#sign-out').click();
      await page.locator('#password').waitFor();
      assert.equal(await page.evaluate(async () => (await fetch('/api/config')).status), 401);
      await page.locator('#password').fill(password);
      await page.locator('#submit').click();
      await page.locator('#session').waitFor({ state: 'visible' });
    }
    assert.deepEqual(errors, []);
    // Keep both contexts alive until browser.close(); some single-process Chromium builds
    // terminate when their last context closes before another context is opened.
    console.log(
      width +
        "px: comparison, scoring, blind review, selection, combination, export, reload and session-only credentials passed.",
    );
  }
  assert.equal(providerCalls, 0);
} finally {
  await browser.close();
  if (tlsFixture) await tlsFixture.close(); else await app.close();
  await rm(directory, { recursive: true, force: true });
}
