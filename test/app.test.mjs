import { presentRun } from '../src/artifacts.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { createApp } from "../src/server.mjs";
import { Store } from "../src/store.mjs";
import {
  makeRun,
  updateReview,
  overall,
  selectedAnswers,
  synthesisInput,
  AppError,
} from "../src/core.mjs";
import {
  ask,
  parseAnswer,
  requestSpec,
  listModels,
} from "../src/providers.mjs";

const ids = ["openai", "gemini", "grok", "claude"];
const fixtures = {
  openai: {
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      {
        type: "message",
        content: [{ type: "output_text", text: "OpenAI fixture" }],
      },
    ],
    usage: { input_tokens: 12, output_tokens: 8 },
  },
  grok: {
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "Grok fixture" }],
      },
    ],
    usage: { input_tokens: 12, output_tokens: 8 },
  },
  gemini: {
    candidates: [
      {
        content: {
          parts: [
            { thought: true, text: "not visible" },
            { text: "Gemini fixture" },
          ],
        },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 },
  },
  claude: {
    content: [
      { type: "thinking", thinking: "not visible" },
      { type: "text", text: "Claude fixture" },
    ],
    usage: { input_tokens: 12, output_tokens: 8 },
    stop_reason: "end_turn",
  },
};
function temporary() {
  return mkdtempSync(join(tmpdir(), "prism-test-"));
}
async function boot(t, options = {}) {
  const directory = options.directory || temporary(),
    app = createApp({ directory, env: {}, ...options });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + app.server.address().port;
  t.after(async () => {
    await app.close();
    if (!options.directory) rmSync(directory, { recursive: true, force: true });
  });
  const call = async (path, method = "GET", data, headers = {}) => {
    const response = await fetch(url + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Prism-Session": app.token,
        ...headers,
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    const raw = await response.text();
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
    return { status: response.status, body, headers: response.headers };
  };
  return { app, url, call, directory };
}
test("all four adapters send the same text and bounded output to fixed endpoints", async () => {
  for (const id of ids) {
    let seen;
    const answer = await ask(
      id,
      "fixture-secret",
      "fixture-model",
      "Common instruction",
      "Identical prompt",
      1024,
      AbortSignal.timeout(1000),
      async (url, options) => {
        seen = { url, options, body: JSON.parse(options.body) };
        return Response.json(fixtures[id]);
      },
    );
    assert.equal(answer.inputTokens, 12);
    assert.equal(answer.outputTokens, 8);
    assert.ok(answer.text.includes("fixture"));
    assert.ok(!answer.text.includes("not visible"));
    assert.equal(seen.options.redirect, "error");
    assert.ok(!seen.url.includes("fixture-secret"));
    if (id === "gemini") {
      assert.equal(seen.options.headers["x-goog-api-key"], "fixture-secret");
      assert.equal(seen.body.contents[0].parts[0].text, "Identical prompt");
      assert.equal(seen.body.generationConfig.maxOutputTokens, 1024);
    } else if (id === "claude") {
      assert.equal(seen.options.headers["anthropic-version"], "2023-06-01");
      assert.equal(seen.body.messages[0].content, "Identical prompt");
      assert.equal(seen.body.system, "Common instruction");
    } else {
      assert.ok(seen.url.endsWith("/responses"));
      assert.equal(seen.body.store, false);
      assert.equal(seen.body.input[1].content, "Identical prompt");
      assert.equal(seen.body.max_output_tokens, 1024);
    }
  }
});
test("partial outputs are flagged; empty outputs and upstream errors are not disguised as answers", async () => {
  assert.ok(
    parseAnswer("openai", { ...fixtures.openai, status: "incomplete" }).warning,
  );
  assert.ok(
    parseAnswer("claude", { ...fixtures.claude, stop_reason: "max_tokens" })
      .warning,
  );
  assert.throws(
    () => parseAnswer("gemini", { candidates: [] }),
    /No supported visible output/,
  );
  let calls = 0;
  await assert.rejects(
    ask(
      "openai",
      "secret",
      "fixture",
      "",
      "Hello",
      1024,
      AbortSignal.timeout(1000),
      async () => {
        calls++;
        return Response.json(
          { error: "secret should never leak" },
          { status: 429 },
        );
      },
    ),
    (e) =>
      e instanceof AppError &&
      e.message.includes("429") &&
      !e.message.includes("secret"),
  );
  assert.equal(calls, 1);
  assert.throws(
    () => requestSpec("gemini", "secret", "https://evil.invalid", "", "", 1024),
    /model ID/,
  );
});
test("model discovery paginates and filters Gemini text generation support", async () => {
  let calls = 0;
  const result = await listModels(
    "gemini",
    "fixture-secret",
    AbortSignal.timeout(1000),
    async (url) => {
      calls++;
      if (calls === 1)
        return Response.json({
          models: [
            {
              name: "models/text-one",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/embed-only",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
          nextPageToken: "next",
        });
      assert.ok(url.includes("pageToken=next"));
      return Response.json({
        models: [
          {
            name: "models/text-two",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      });
    },
  );
  assert.deepEqual(result.models, ["text-one", "text-two"]);
  assert.equal(calls, 2);
});
test("scores preserve unrated values and prevent stale review overwrites", () => {
  const run = makeRun(
      { prompt: "Test", providers: ["openai"], mode: "demo" },
      {},
    ),
    r = run.responses[0];
  assert.equal(overall(r.scores), null);
  updateReview(r, { version: 0, scores: { accuracy: 5, usefulness: 4 } });
  assert.equal(overall(r.scores), null);
  updateReview(r, { version: 1, scores: { clarity: 3 } });
  assert.equal(overall(r.scores), 4);
  assert.throws(
    () => updateReview(r, { version: 1, notes: "stale" }),
    /another tab/,
  );
  assert.throws(
    () => updateReview(r, { version: 2, scores: { accuracy: 6 } }),
    /1–5/,
  );
  assert.throws(
    () => updateReview(r, { version: 2, scores: null }),
    /Invalid scores/,
  );
});
test("synthesis includes only selected complete sources with scores and provenance labels", () => {
  const run = makeRun(
    { prompt: "Question", providers: ["openai", "gemini"], mode: "demo" },
    {},
  );
  const [a, b] = run.responses;
  a.status = "complete";
  a.text = "Chosen";
  a.notes = "Useful";
  a.scores.accuracy = 4;
  b.status = "complete";
  b.text = "Not chosen";
  const selected = selectedAnswers(run, [a.provider]),
    input = synthesisInput(run, selected, "Keep details");
  const data = JSON.parse(input.prompt);
  assert.equal(data.candidates.length, 1);
  assert.equal(data.candidates[0].answer, "Chosen");
  assert.equal(data.candidates[0].reviewNotes, "Useful");
  assert.equal(data.candidates[0].scores.accuracy, 4);
  assert.ok(input.system.includes("untrusted"));
  assert.ok(!input.prompt.includes("Not chosen"));
});
test("optional remembered keys persist privately while session-only keys do not", () => {
  const dir = temporary();
  try {
    let store = new Store(dir, {});
    store.setConnection("openai", {
      key: "fixture-remember",
      model: "test",
      remember: true,
    });
    store.setConnection("claude", {
      key: "fixture-session",
      model: "test",
      remember: false,
    });
    assert.equal(store.connections().openai.hasKey, true);
    assert.ok(
      !JSON.stringify(store.connections()).includes("fixture-remember"),
    );
    assert.equal(statSync(join(dir, "workspace.json")).mode & 0o777, 0o600);
    assert.ok(
      !readFileSync(join(dir, "workspace.json"), "utf8").includes(
        "fixture-session",
      ),
    );
    store.close();
    store = new Store(dir, {});
    assert.equal(store.key("openai"), "fixture-remember");
    assert.equal(store.key("claude"), "");
    store.setConnection("openai", {
      key: "",
      model: "test-two",
      remember: false,
    });
    assert.equal(store.key("openai"), "fixture-remember");
    assert.ok(
      !readFileSync(join(dir, "workspace.json"), "utf8").includes(
        "fixture-remember",
      ),
    );
    store.disconnect("openai");
    assert.equal(store.key("openai"), "");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("corrupt data is preserved and two servers cannot share a workspace", () => {
  const dir = temporary();
  try {
    const store = new Store(dir, {});
    assert.throws(() => new Store(dir, {}), /already uses/);
    store.close();
    writeFileSync(join(dir, "workspace.json"), "{broken");
    assert.throws(() => new Store(dir, {}), /not been reset/);
    assert.equal(readFileSync(join(dir, "workspace.json"), "utf8"), "{broken");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("disk save failure preserves acknowledged state", () => {
  const dir = temporary();
  try {
    const store = new Store(dir, {});
    const run = store.add(
      makeRun({ prompt: "Keep", providers: ["openai"], mode: "demo" }, {}),
    );
    const prior = readFileSync(join(dir, "workspace.json"), "utf8");
    mkdirSync(join(dir, "workspace.json.tmp"));
    assert.throws(
      () => store.update(run.id, (r) => (r.title = "Lost")),
      /previous saved workspace was preserved/,
    );
    assert.equal(store.get(run.id).title, "Keep");
    assert.equal(readFileSync(join(dir, "workspace.json"), "utf8"), prior);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("HTTP rejects missing session, foreign origin, host attacks and oversized input", async (t) => {
  const { call, url } = await boot(t);
  assert.equal(
    (await call("/config", "GET", undefined, { "X-Prism-Session": "" })).status,
    401,
  );
  assert.equal(
    (
      await call("/config", "GET", undefined, {
        Origin: "https://evil.invalid",
      })
    ).status,
    403,
  );
  const hostileHost = await new Promise((resolve, reject) => {
    const req = httpRequest(
      url + "/api/config",
      { headers: { Host: "evil.invalid" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(hostileHost, 403);
  assert.equal(
    (
      await call("/runs", "POST", {
        prompt: "x".repeat(30001),
        providers: ["openai"],
        mode: "demo",
      })
    ).status,
    400,
  );
  assert.equal((await fetch(url + "/src/store.mjs")).status, 404);
  assert.ok(
    (await fetch(url)).headers
      .get("content-security-policy")
      .includes("frame-ancestors 'none'"),
  );
});
test("demo compare, score, select, combine, edit, export and restart make no provider calls", async (t) => {
  let requests = 0;
  const directory = temporary();
  const { call, app } = await boot(t, {
    directory,
    fetcher: async () => {
      requests++;
      throw Error("Unexpected provider call");
    },
  });
  const made = await call("/runs", "POST", {
    prompt: "Synthetic prompt",
    providers: ids,
    mode: "demo",
  });
  assert.equal(made.status, 201);
  const id = made.body.run.id;
  await Promise.all(
    ids.map((provider) =>
      call("/runs/" + id + "/answer", "POST", { provider }),
    ),
  );
  let run = (await call("/runs/" + id)).body.run;
  assert.equal(run.responses.filter((r) => r.status === "complete").length, 4);
  assert.equal(requests, 0);
  const a = run.responses[0],
    b = run.responses[1];
  run = (
    await call("/runs/" + id + "/review", "PATCH", {
      provider: a.provider,
      version: 0,
      scores: { accuracy: 5, usefulness: 4, clarity: 3 },
      notes: "My note",
      selected: true,
    })
  ).body.run;
  assert.equal(run.responses[0].notes, "My note");
  assert.equal(
    (
      await call("/runs/" + id + "/review", "PATCH", {
        provider: a.provider,
        version: 0,
        notes: "Overwrite",
      })
    ).status,
    409,
  );
  run = (
    await call("/runs/" + id + "/combine", "POST", {
      providers: [a.provider, b.provider],
      method: "compile",
      version: 0,
    })
  ).body.run;
  assert.ok(run.combined.text.includes("My note"));
  assert.deepEqual(run.combined.sources, [a.label, b.label]);
  run = (
    await call("/runs/" + id + "/combined", "PATCH", {
      version: 1,
      text: "My final edited answer",
    })
  ).body.run;
  assert.equal(run.combined.text, "My final edited answer");
  const exported = (await call("/runs/" + id + "/export")).body;
  assert.equal(exported.run.combined.text, "My final edited answer");
  assert.ok(
    (await call("/runs/" + id + "/export?format=md")).body.includes(
      "My final edited answer",
    ),
  );
  assert.ok(!JSON.stringify(exported).includes("connections"));
  assert.equal(requests, 0);
  await app.close();
  const restored = new Store(directory, {});
  assert.equal(restored.get(id).combined.text, "My final edited answer");
  restored.close();
  rmSync(directory, { recursive: true, force: true });
});
test("draft history preserves legacy edits, restores without loss, rejects stale writes and survives restart", async (t) => {
  const { call, app, directory } = await boot(t);
  // A 0.1.0 workspace has a combined draft but no history field.
  const legacy = makeRun({ prompt: "Legacy session", providers: ["openai"], mode: "demo" }, {});
  legacy.combined = { ...legacy.combined, text: "Original saved work", method: "Manual draft", version: 3 };
  app.store.add(legacy);
  const path = "/runs/" + legacy.id;
  let response = await call(path + "/combined", "PATCH", { version: 3, text: "Edited work" });
  assert.equal(response.status, 200);
  let run = response.body.run;
  assert.equal(run.combinedHistory[0].text, "Original saved work");
  const original = run.combinedHistory[0].historyId;
  await call(path + "/answer", "POST", { provider: "openai" });
  response = await call(path + "/combine", "POST", { version: 4, method: "compile", providers: ["openai"] });
  assert.equal(response.status, 200);
  run = response.body.run;
  assert.equal(run.combinedHistory[1].text, "Edited work");
  const compilation = run.combined.text;
  assert.equal((await call(path + "/combined", "PATCH", { version: 4, historyId: original })).status, 409);
  assert.equal((await call(path + "/combined", "PATCH", { version: 5, historyId: "absent" })).status, 404);
  assert.equal((await call(path)).body.run.combinedHistory.length, 2);
  run = (await call(path + "/combined", "PATCH", { version: 5, historyId: original })).body.run;
  assert.equal(run.combined.text, "Original saved work");
  assert.equal(run.combined.version, 6);
  assert.equal(run.combined.restoredFrom, 3);
  assert.equal(run.combinedHistory[2].text, compilation);
  assert.ok(run.combinedHistory.every((draft) => !draft.combinedHistory));
  assert.deepEqual((await call(path + "/export")).body.run.combinedHistory, run.combinedHistory);
  const md = (await call(path + "/export?format=md")).body;
  assert.ok(md.includes("## Draft history") && md.includes("Edited work"));
  await app.close();
  const reopened = new Store(directory, {});
  assert.deepEqual(presentRun(reopened.get(legacy.id)), run);
  reopened.close();
});

test("failed synthesis does not replace or archive a draft", async (t) => {
  let calls = 0;
  const { call, app } = await boot(t, { fetcher: async () => { calls++; return Response.json({}, { status: 429 }); } });
  await call("/connections/openai", "PUT", { model: "fixture-model", key: "fixture-key", remember: false });
  const made = await call("/runs", "POST", { prompt: "Synthetic", providers: ["openai"], mode: "demo" });
  const path = "/runs/" + made.body.run.id;
  await call(path + "/answer", "POST", { provider: "openai" });
  let run = (await call(path + "/combined", "PATCH", { text: "Keep me", version: 0 })).body.run;
  // Successful demo synthesis archives the exact prior draft.
  run = (await call(path + "/combine", "POST", { method: "synthesize", provider: "openai", providers: ["openai"], version: 1 })).body.run;
  assert.equal(run.combinedHistory[0].text, "Keep me");
  app.store.update(run.id, (current) => { current.mode = "live"; });
  const before = (await call(path)).body.run;
  await call(path + "/combine", "POST", { method: "synthesize", provider: "openai", providers: ["openai"], version: before.combined.version });
  const after = (await call(path)).body.run;
  assert.equal(calls, 1);
  assert.deepEqual(after.combined, before.combined);
  assert.deepEqual(after.combinedHistory, before.combinedHistory);
});

test("live requests run concurrently, isolate provider failure, and reject duplicate generation", async (t) => {
  let active = 0,
    maxActive = 0,
    calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 40));
    active--;
    if (url.includes("anthropic"))
      return Response.json({ error: "fixture-secret" }, { status: 429 });
    return Response.json(
      url.includes("googleapis")
        ? fixtures.gemini
        : url.includes("api.x.ai")
          ? fixtures.grok
          : fixtures.openai,
    );
  };
  const { call } = await boot(t, { fetcher });
  for (const id of ids)
    assert.equal(
      (
        await call("/connections/" + id, "PUT", {
          key: "fixture-secret",
          model: "fixture-model",
          remember: false,
        })
      ).status,
      200,
    );
  const made = await call("/runs", "POST", {
    prompt: "Identical prompt",
    instructions: "Common instruction",
    providers: ids,
    mode: "live",
  });
  const id = made.body.run.id;
  await Promise.all(
    ids.map((provider) =>
      call("/runs/" + id + "/answer", "POST", { provider }),
    ),
  );
  const run = (await call("/runs/" + id)).body.run;
  assert.ok(maxActive > 1);
  assert.equal(calls, 4);
  assert.equal(run.responses.filter((r) => r.status === "complete").length, 3);
  assert.ok(
    run.responses.find((r) => r.provider === "claude").error.includes("429"),
  );
  assert.ok(!JSON.stringify(run).includes("fixture-secret"));
  assert.equal(
    (await call("/runs/" + id + "/answer", "POST", { provider: "openai" }))
      .status,
    409,
  );
  assert.equal(calls, 4);
  const combined = await call("/runs/" + id + "/combine", "POST", {
    providers: ["openai", "gemini"],
    method: "synthesize",
    provider: "grok",
    version: 0,
    direction: "Combine",
  });
  assert.equal(combined.status, 200);
  assert.equal(calls, 5);
  assert.equal(combined.body.run.combined.method, "AI synthesis");
});
test("stop cancels an in-flight request without automatic replay", async (t) => {
  let calls = 0;
  const { call } = await boot(t, {
    fetcher: async (url, { signal }) => {
      calls++;
      await new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(Error("cancelled")), {
          once: true,
        }),
      );
    },
  });
  await call("/connections/openai", "PUT", {
    key: "fixture-key",
    model: "fixture-model",
    remember: false,
  });
  const run = (
    await call("/runs", "POST", {
      prompt: "Cancel me",
      providers: ["openai"],
      mode: "live",
    })
  ).body.run;
  const pending = call("/runs/" + run.id + "/answer", "POST", {
    provider: "openai",
  });
  while (!calls) await new Promise((r) => setTimeout(r, 5));
  await call("/runs/" + run.id + "/stop", "POST", {});
  const result = await pending;
  assert.equal(result.body.run.responses[0].status, "error");
  assert.equal(calls, 1);
  assert.ok(result.body.run.responses[0].error.includes("No automatic retry"));
});
