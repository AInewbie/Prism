import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBackend } from './backend.mjs';
import { createMcpServer } from './mcp.mjs';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
export async function start() {
  const backend = await createBackend();
  const server = createMcpServer(backend);
  try { await server.connect(new StdioServerTransport()); }
  catch (error) { await server.close(); await backend.close(); throw error; }
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true;
    await server.close(); await backend.close();
  };
  process.on('SIGINT',close); process.on('SIGTERM',close);
  process.stdin.on('end',close);
  return {server,backend,close};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  start().catch(() => { console.error('Prism plugin could not start. Check local dependencies, configuration and data-directory access.'); process.exitCode=1; });
