import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "./store.mjs";
import { replaceDraft, restoreDraft } from "./drafts.mjs";
import {
  AppError,
  PROVIDERS,
  provider,
  makeRun,
  updateReview,
  selectedAnswers,
  compilation,
  synthesisInput,
  exportMarkdown,
  demoAnswer,
  text,
} from "./core.mjs";
import { ask, listModels } from "./providers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/session-search.js", ["session-search.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/logo.svg", ["logo.svg", "image/svg+xml"]],
]);
function reply(res, status, value, type = "application/json; charset=utf-8") {
  if (res.destroyed) return;
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type.startsWith("application/json") ? JSON.stringify(value) : value);
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 800000) throw new AppError("Request is too large.", 413);
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error();
    return data;
  } catch {
    throw new AppError("Send a JSON object.");
  }
}
export function createApp({
  directory,
  fetcher = fetch,
  env = process.env,
  timeoutMs = 120000,
} = {}) {
  const store = new Store(
    directory || join(homedir(), ".local", "share", "prism"),
    env,
  );
  const token = randomBytes(32).toString("hex"),
    active = new Map();
  let stopping = false;
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      const port = server.address()?.port;
      const hosts = ["127.0.0.1:" + port, "localhost:" + port];
      if (!hosts.includes(req.headers.host))
        throw new AppError("Untrusted host.", 403);
      if (
        req.headers.origin &&
        !hosts.some((h) => req.headers.origin === "http://" + h)
      )
        throw new AppError("Cross-origin requests are blocked.", 403);
      const path = new URL(req.url, "http://127.0.0.1").pathname;
      if (!path.startsWith("/api/")) {
        const asset = assets.get(path);
        if (!asset || req.method !== "GET")
          throw new AppError("Not found.", 404);
        return reply(
          res,
          200,
          readFileSync(join(root, "public", asset[0])),
          asset[1],
        );
      }
      const supplied = req.headers["x-prism-session"];
      if (
        typeof supplied !== "string" ||
        !/^[a-f0-9]{64}$/.test(supplied) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      )
        throw new AppError(
          "Open the complete launch URL from the terminal to connect.",
          401,
        );
      if (stopping) throw new AppError("Server is shutting down.", 503);
      if (
        req.method !== "GET" &&
        !req.headers["content-type"]?.startsWith("application/json")
      )
        throw new AppError("JSON content type is required.", 415);
      if (path === "/api/config" && req.method === "GET")
        return reply(res, 200, {
          providers: PROVIDERS,
          connections: store.connections(),
          version: "0.2.0",
        });
      const connectionMatch = path.match(
        /^\/api\/connections\/(openai|gemini|grok|claude)$/,
      );
      if (connectionMatch) {
        const id = connectionMatch[1];
        if (req.method === "PUT")
          return reply(res, 200, {
            connections: store.setConnection(id, await body(req)),
          });
        if (req.method === "DELETE") {
          store.disconnect(id);
          return reply(res, 200, { connections: store.connections() });
        }
      }
      const modelsMatch = path.match(
        /^\/api\/models\/(openai|gemini|grok|claude)$/,
      );
      if (modelsMatch && req.method === "POST") {
        const id = modelsMatch[1],
          key = store.key(id);
        if (!key) throw new AppError("Save this provider's API key first.");
        return reply(
          res,
          200,
          await listModels(id, key, AbortSignal.timeout(30000), fetcher),
        );
      }
      if (path === "/api/runs") {
        if (req.method === "GET")
          return reply(res, 200, { runs: store.list() });
        if (req.method === "POST")
          return reply(res, 201, {
            run: store.add(makeRun(await body(req), store.connections())),
          });
      }
      const match = path.match(
        /^\/api\/runs\/([a-f0-9-]{36})(?:\/(answer|review|stop|combine|combined|export))?$/,
      );
      if (!match) throw new AppError("Not found.", 404);
      const [, id, action] = match,
        run = store.get(id);
      if (!action && req.method === "GET") return reply(res, 200, { run });
      if (action === "export" && req.method === "GET") {
        const format = new URL(req.url, "http://127.0.0.1").searchParams.get(
          "format",
        );
        if (format === "md")
          return reply(
            res,
            200,
            exportMarkdown(run),
            "text/markdown; charset=utf-8",
          );
        return reply(res, 200, { application: "Prism", version: "0.1.0", run });
      }
      if (action === "stop" && req.method === "POST") {
        for (const [key, controller] of active)
          if (key.startsWith(id + ":")) controller.abort();
        return reply(res, 200, { stopping: true });
      }
      if (action === "review" && req.method === "PATCH") {
        const patch = await body(req);
        provider(patch.provider);
        return reply(res, 200, {
          run: store.update(id, (current) => {
            const answer = current.responses.find(
              (r) => r.provider === patch.provider,
            );
            if (!answer || answer.status !== "complete")
              throw new AppError("This answer is not complete.");
            updateReview(answer, patch);
          }),
        });
      }
      if (action === "combined" && req.method === "PATCH") {
        const patch = await body(req);
        if (active.has(id + ":combine"))
          throw new AppError(
            "A synthesis is in progress. Keep your draft and save it after generation finishes.",
            409,
          );
        return reply(res, 200, {
          run: store.update(id, (current) => {
            if (patch.version !== current.combined.version)
              throw new AppError(
                "The combined answer changed in another tab. Copy your draft before reloading.",
                409,
              );
            if (patch.historyId !== undefined) {
              restoreDraft(current, patch.historyId);
            } else {
              replaceDraft(current, {
                ...current.combined,
                text: text(patch.text, "Combined answer", 550000),
                method: current.combined.method || "Manual draft",
              });
            }
          }),
        });
      }
      if (
        (action === "answer" || action === "combine") &&
        req.method === "POST"
      ) {
        const request = await body(req);
        let response,
          answers,
          combinePrompt,
          outputProvider,
          outputModel,
          activeKey;
        if (action === "answer") {
          provider(request.provider);
          response = run.responses.find((r) => r.provider === request.provider);
          if (!response)
            throw new AppError("Provider is not part of this comparison.");
          if (!["pending", "error"].includes(response.status))
            throw new AppError(
              "Answer already requested. Start a new comparison to generate it again.",
              409,
            );
          outputProvider = response.provider;
          outputModel = response.model;
          activeKey = id + ":" + outputProvider;
        } else {
          if (!["compile", "synthesize"].includes(request.method))
            throw new AppError("Choose a combination method.");
          if (request.version !== run.combined.version)
            throw new AppError(
              "Combined answer changed. Reload before replacing it.",
              409,
            );
          answers = selectedAnswers(run, request.providers);
          const direction = text(
            request.direction ?? "",
            "Combination instructions",
            8000,
          );
          combinePrompt = synthesisInput(run, answers, direction);
          activeKey = id + ":combine";
          if (active.has(activeKey))
            throw new AppError("A combination is already in progress.", 409);
          if (request.method === "compile") {
            return reply(res, 200, {
              run: store.update(id, (current) => {
                replaceDraft(current, {
                  text: compilation(run, answers),
                  method: "Editable compilation",
                  provider: null,
                  model: null,
                  sources: answers.map((r) => r.label),
                  instructions: direction,
                  version: current.combined.version + 1,
                });
              }),
            });
          }
          provider(request.provider);
          outputProvider = request.provider;
          outputModel = store.connections()[outputProvider]?.model;
          if (run.mode === "live" && !outputModel)
            throw new AppError("Choose a synthesizer model in Connections.");
        }
        if (active.has(activeKey))
          throw new AppError("This request is already running.", 409);
        if (active.size >= 8)
          throw new AppError(
            "Too many active requests. Wait for an answer.",
            429,
          );
        const key = store.key(outputProvider);
        if (run.mode === "live" && !key)
          throw new AppError("Connect the selected provider first.");
        if (action === "answer")
          store.update(id, (current) => {
            const r = current.responses.find(
              (r) => r.provider === outputProvider,
            );
            r.status = "running";
            r.error = "";
          });
        const controller = new AbortController();
        active.set(activeKey, controller);
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(timeoutMs),
        ]);
        const onClose = () => {
          if (!res.writableEnded) controller.abort();
        };
        res.on("close", onClose);
        const started = performance.now();
        try {
          let answer;
          if (run.mode === "demo") {
            await delay(
              280 + PROVIDERS.findIndex((p) => p.id === outputProvider) * 180,
              null,
              { signal },
            );
            answer = {
              text:
                action === "answer"
                  ? demoAnswer(outputProvider, run.prompt)
                  : "# Demo combined draft\n\nThis is a local sample compilation, not an AI synthesis.\n\n" +
                    answers
                      .map((r) => "## Source [" + r.label + "]\n\n" + r.text)
                      .join("\n\n") +
                    "\n\n## Review before using\n\nCheck disagreements and verify important claims. No provider was called.",
              warning: "",
              inputTokens: null,
              outputTokens: null,
            };
          } else {
            answer = await ask(
              outputProvider,
              key,
              outputModel,
              action === "answer" ? run.instructions : combinePrompt.system,
              action === "answer" ? run.prompt : combinePrompt.prompt,
              run.maxTokens,
              signal,
              fetcher,
            );
          }
          if (signal.aborted) throw new AppError("Request stopped.", 499);
          const updated = store.update(id, (current) => {
            if (action === "answer") {
              const r = current.responses.find(
                (r) => r.provider === outputProvider,
              );
              Object.assign(r, answer, {
                status: "complete",
                elapsedMs: Math.round(performance.now() - started),
              });
            } else {
              if (current.combined.version !== request.version)
                throw new AppError(
                  "The combined answer changed while generation was running.",
                  409,
                );
              replaceDraft(current, {
                ...answer,
                method:
                  run.mode === "demo"
                    ? "Demo compilation (no AI call)"
                    : "AI synthesis",
                provider: outputProvider,
                model: run.mode === "demo" ? "Sample synthesis" : outputModel,
                sources: answers.map((r) => r.label),
                sourceReviews: answers.map((r) => ({
                  label: r.label,
                  scores: r.scores,
                  notes: r.notes,
                })),
                instructions: request.direction || "",
                version: current.combined.version + 1,
              });
            }
          });
          return reply(res, 200, { run: updated });
        } catch (e) {
          const message = signal.aborted
            ? "Request stopped or timed out. The provider may already have used API credits. No automatic retry."
            : e instanceof AppError
              ? e.message
              : "The request failed. No automatic retry.";
          if (action === "answer") {
            const updated = store.update(id, (current) => {
              const r = current.responses.find(
                (r) => r.provider === outputProvider,
              );
              r.status = "error";
              r.error = message;
            });
            return reply(res, 200, { run: updated });
          }
          throw new AppError(message, e.status || 502);
        } finally {
          active.delete(activeKey);
          res.off("close", onClose);
        }
      }
      throw new AppError("Method not allowed.", 405);
    } catch (e) {
      reply(res, e instanceof AppError ? e.status : 500, {
        error:
          e instanceof AppError
            ? e.message
            : "Local server error. Check disk access and restart if needed.",
      });
    }
  });
  server.requestTimeout = 150000;
  server.headersTimeout = 15000;
  return {
    server,
    token,
    store,
    async close() {
      stopping = true;
      for (const controller of active.values()) controller.abort();
      await new Promise((resolveClose) => server.close(resolveClose));
      store.close();
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PRISM_PORT || 8795);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("PRISM_PORT must be between 1 and 65535.");
  const app = createApp({ directory: process.env.PRISM_DATA_DIR });
  app.server.once("error", () => {
    app.store.close();
    console.error("Cannot start Prism. Check the port and data directory.");
    process.exitCode = 1;
  });
  app.server.listen(port, "127.0.0.1", () => {
    console.log("Prism 0.1.0 — local model comparison studio");
    console.log("Open: http://127.0.0.1:" + port + "/#key=" + app.token);
    console.log("Keep this terminal open. Press Ctrl+C to stop.");
  });
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
