import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { AppError, PROVIDERS, modelId, text } from "./core.mjs";

export class Store {
  constructor(directory, env = process.env) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = join(directory, "workspace.json");
    this.lock = join(directory, "server.lock");
    this.sessionKeys = {};
    this.closed = false;
    try {
      this.lockFd = openSync(this.lock, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(readFileSync(this.lock, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0)
        throw Error(
          "Invalid server lock. Preserve your data and inspect server.lock.",
        );
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (e) {
        if (e.code === "ESRCH") alive = false;
      }
      if (alive)
        throw Error(
          "A Prism server already uses this data directory. Stop it or choose another PRISM_DATA_DIR.",
        );
      unlinkSync(this.lock);
      this.lockFd = openSync(this.lock, "wx", 0o600);
    }
    writeFileSync(this.lockFd, String(process.pid));
    try {
      try {
        this.data = JSON.parse(readFileSync(this.file, "utf8"));
      } catch (e) {
        if (e.code !== "ENOENT")
          throw Error(
            "Saved workspace could not be read. It has not been reset. Restore a backup before restarting.",
          );
        this.data = { version: 1, connections: {}, runs: [] };
      }
      if (
        this.data.version !== 1 ||
        !Array.isArray(this.data.runs) ||
        !this.data.connections
      )
        throw Error("Unsupported saved workspace; no data was changed.");
      const names = {
        openai: "OPENAI_API_KEY",
        gemini: "GEMINI_API_KEY",
        grok: "XAI_API_KEY",
        claude: "ANTHROPIC_API_KEY",
      };
      for (const p of PROVIDERS)
        if (env[names[p.id]]) this.sessionKeys[p.id] = env[names[p.id]];
      let recovered = false;
      for (const run of this.data.runs)
        for (const r of run.responses || []) {
          if (r.status === "running") {
            r.status = "error";
            r.error =
              "Interrupted by server restart. Retry only if you want a new request.";
            recovered = true;
          }
        }
      if (recovered) this.commit(structuredClone(this.data));
    } catch (e) {
      this.close();
      throw e;
    }
  }
  commit(next) {
    if (this.closed) throw new AppError("Server is shutting down.", 503);
    const serialized = JSON.stringify(next, null, 2);
    if (Buffer.byteLength(serialized) > 40_000_000)
      throw new AppError(
        "Local workspace is full. Export sessions and archive the data directory before continuing.",
        507,
      );
    const temporary = this.file + ".tmp";
    try {
      writeFileSync(temporary, serialized, { mode: 0o600 });
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.file);
    } catch {
      throw new AppError(
        "Could not save to disk. The previous saved workspace was preserved.",
        507,
      );
    }
    this.data = next;
  }
  connections() {
    return Object.fromEntries(
      PROVIDERS.map((p) => [
        p.id,
        {
          model: this.data.connections[p.id]?.model || "",
          imageModel: this.data.connections[p.id]?.imageModel || "",
          hasKey: !!this.key(p.id),
          remembered: !!this.data.connections[p.id]?.key,
        },
      ]),
    );
  }
  key(id) {
    return this.sessionKeys[id] || this.data.connections[id]?.key || "";
  }
  setConnection(id, body) {
    const next = structuredClone(this.data),
      old = next.connections[id] || {};
    const model = body.model ? modelId(body.model) : "";
    const imageModel =
      body.imageModel === undefined
        ? old.imageModel || ""
        : body.imageModel
          ? modelId(body.imageModel)
          : "";
    const key = text(body.key ?? "", "API key", 4096).trim();
    if (/[\s\x00-\x1f\x7f]/.test(key))
      throw new AppError("API keys cannot contain whitespace.");
    if (typeof body.remember !== "boolean")
      throw new AppError("Choose whether to remember the key.");
    const effective = key || this.key(id);
    next.connections[id] = {
      model,
      imageModel,
      ...(body.remember && effective ? { key: effective } : {}),
    };
    this.commit(next);
    if (body.remember) delete this.sessionKeys[id];
    else if (effective) this.sessionKeys[id] = effective;
    return this.connections();
  }
  disconnect(id) {
    const next = structuredClone(this.data);
    delete next.connections[id];
    this.commit(next);
    delete this.sessionKeys[id];
  }
  list() {
    return this.data.runs.map(({ id, title, createdAt, mode, responses }) => ({
      id,
      title,
      createdAt,
      mode,
      completed: responses.filter((r) => r.status === "complete").length,
      total: responses.length,
    }));
  }
  get(id) {
    const run = this.data.runs.find((r) => r.id === id);
    if (!run) throw new AppError("Session not found.", 404);
    return structuredClone(run);
  }
  add(run) {
    if (this.data.runs.length >= 500)
      throw new AppError(
        "500-session limit reached. Export and archive your workspace before starting another.",
        507,
      );
    const next = structuredClone(this.data);
    next.runs.unshift(run);
    this.commit(next);
    return this.get(run.id);
  }
  update(id, fn) {
    const next = structuredClone(this.data),
      run = next.runs.find((r) => r.id === id);
    if (!run) throw new AppError("Session not found.", 404);
    fn(run);
    run.revision = (run.revision || 0) + 1;
    run.updatedAt = new Date().toISOString();
    this.commit(next);
    return this.get(id);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.lockFd !== undefined) {
      closeSync(this.lockFd);
      unlinkSync(this.lock);
    }
  }
}
