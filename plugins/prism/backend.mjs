import { homedir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server.mjs';
import { AppError, makeRun, modelId, PROVIDERS } from '../../src/core.mjs';

// Reuse the verified standalone API. It listens on loopback with a per-process
// token; that token is never returned in MCP tool results or widget HTML.
export async function createBackend({ directory, env = process.env, fetcher, timeoutMs } = {}) {
  // Validate before acquiring a workspace lock or starting a listener.
  const configuredModels = PROVIDERS.flatMap(({id}) => {
    const configured = env['PRISM_MODEL_' + id.toUpperCase()];
    return configured ? [[id, modelId(configured)]] : [];
  });
  const app = createApp({ directory: directory || env.PRISM_PLUGIN_DATA_DIR ||
    join(homedir(), '.local', 'share', 'prism-chatgpt'), env, fetcher, timeoutMs });
  try {
    const changed = configuredModels.filter(([id, model]) => app.store.data.connections[id]?.model !== model);
    if (changed.length) {
      const next = structuredClone(app.store.data);
      for (const [id, model] of changed) next.connections[id] = { ...next.connections[id], model };
      app.store.commit(next);
    }
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) { await app.close(); throw error; }
  const url = 'http://127.0.0.1:' + app.server.address().port;
  const jobs = new Map();
  const liveEnabled = env.PRISM_PLUGIN_ALLOW_LIVE === '1';
  async function call(path, method = 'GET', data) {
    const response = await fetch(url + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Prism-Session': app.token },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const result = await response.json();
    if (!response.ok) throw new AppError(result.error || 'Prism request failed.', response.status);
    return result;
  }
  function guardLive(mode, acknowledged) {
    if (mode !== 'live') return;
    if (!liveEnabled) throw new AppError('Live calls are disabled on this server. Configure keys locally and explicitly enable PRISM_PLUGIN_ALLOW_LIVE first.');
    if (!acknowledged) throw new AppError('Confirm that this action sends data to the selected providers and can use API credits.');
  }
  function state(id) {
    const run = id ? app.store.get(id) : null;
    return { run, sessions: app.store.list(), connections: app.store.connections(), liveEnabled,
      busy: !!id && jobs.has(id), providers: PROVIDERS.map(({id, name}) => ({id, name})) };
  }
  return {
    app, url, call, state, liveEnabled,
    async compare(args) {
      guardLive(args.mode, args.acknowledge_paid);
      const existing = app.store.data.runs.find((run) => run.pluginRequestId === args.request_id);
      const signature = JSON.stringify({ prompt: args.prompt, instructions: args.instructions || '',
        providers: [...args.providers].sort(), mode: args.mode, maxTokens: args.max_tokens });
      if (existing) {
        if (existing.pluginSignature !== signature) throw new AppError('Request ID already belongs to a different comparison.', 409);
        return existing.id;
      }
      if (jobs.size) throw new AppError('A comparison is still running. Wait or stop it before starting another.', 409);
      const run = makeRun({ prompt: args.prompt, instructions: args.instructions,
        providers: args.providers, mode: args.mode, maxTokens: args.max_tokens }, app.store.connections());
      app.store.add({ ...run, pluginRequestId: args.request_id, pluginSignature: signature });
      const job = Promise.allSettled(run.responses.map((answer) =>
        call('/runs/' + run.id + '/answer', 'POST', { provider: answer.provider })));
      jobs.set(run.id, job);
      job.finally(() => jobs.delete(run.id));
      return run.id;
    },
    async combine(args) {
      const run = app.store.get(args.run_id);
      if (args.method === 'synthesize') guardLive(run.mode, args.acknowledge_paid);
      await call('/runs/' + args.run_id + '/combine', 'POST', {
        providers: args.providers, method: args.method, direction: args.direction,
        provider: args.provider, version: args.version,
      });
    },
    setModel(id, model) {
      const next = structuredClone(app.store.data);
      next.connections[id] = { ...next.connections[id], model: modelId(model) };
      app.store.commit(next);
    },
    async close() {
      for (const id of jobs.keys()) await call('/runs/' + id + '/stop', 'POST', {});
      await Promise.allSettled([...jobs.values()]);
      await app.close();
    },
  };
}
