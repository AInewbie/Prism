import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createApp } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { fileArtifact, addArtifacts, addProviderArtifacts, presentRun, codeArtifacts, MAX_FILE_BYTES } from '../src/artifacts.mjs';
import { parseAnswer, ask } from '../src/providers.mjs';
import { synthesisInput } from '../src/core.mjs';

test('visible inline media, executable files and code fences survive each adapter without thought leakage', () => {
  const data = Buffer.from('visible image bytes').toString('base64');
  const gemini = parseAnswer('gemini', { candidates: [{ content: { parts: [
    { thought: true, inlineData: { mimeType: 'image/png', data: Buffer.from('private reasoning').toString('base64') } },
    { inlineData: { mimeType: 'image/png', data } },
    { executableCode: { language: 'PYTHON', code: 'print(1)' } },
  ] } }] });
  assert.equal(gemini.text, ''); assert.equal(gemini.artifacts.length, 2);
  assert.equal(gemini.artifacts[0].data, data);
  assert.ok(!JSON.stringify(gemini).includes('private reasoning'));
  const openai = parseAnswer('openai', { output: [{ type: 'image_generation_call', result: data, output_format: 'webp' }] });
  assert.equal(openai.artifacts[0].mimeType, 'image/webp');
  const claude = parseAnswer('claude', { content: [{ type: 'text', text: '```html index.html\n<h1>Hi</h1>\n```' }] });
  assert.equal(claude.artifacts[0].name, 'index.html');
  assert.equal(Buffer.from(claude.artifacts[0].data, 'base64').toString(), '<h1>Hi</h1>\n');
  const grok = parseAnswer('grok', { output: [{ type: 'message', content: [{ type: 'output_text', text: '```json\n{"a":1}\n```' }] }] });
  assert.equal(grok.artifacts[0].mimeType, 'application/json');
});

test('provider references remain explicit and are never fetched as arbitrary URLs', async () => {
  let calls = 0;
  const answer = await ask('gemini', 'synthetic-key', 'fixture', '', 'files', 2048, AbortSignal.timeout(1000), async () => {
    calls++; return Response.json({ candidates: [{ content: { parts: [{ fileData: { fileUri: 'http://localhost/private', mimeType: 'application/pdf' } }] } }] });
  });
  assert.equal(calls, 1); assert.equal(answer.artifacts[0].encoding, 'reference');
  assert.match(answer.warning, /downloaded copy/);
  const claude = parseAnswer('claude', { content: [{ type: 'bash_code_execution_tool_result', content: { content: [{ type: 'bash_code_execution_output', file_id: 'file_example' }] } }] });
  assert.equal(claude.artifacts[0].reference.id, 'file_example');
});

test('invalid media does not discard valid text and attachment-only answers are accepted', () => {
  const result = parseAnswer('gemini', { candidates: [{ content: { parts: [{ text: 'Keep this answer' }, { inlineData: { mimeType: 'image/png', data: 'not base64!' } }] } }] });
  assert.equal(result.text, 'Keep this answer'); assert.equal(result.artifacts.length, 0); assert.match(result.warning, /could not be saved/);
  assert.throws(() => parseAnswer('claude', { content: [{ type: 'thinking', thinking: 'hidden' }] }), /No supported visible output/);
});

test('file validation preserves exact bytes, removes paths and bounds decoding/storage', () => {
  const bytes = Buffer.from([0, 255, 13, 10]);
  const artifact = fileArtifact({ name: '../../file.bin', data: bytes.toString('base64') });
  assert.equal(artifact.name, 'file.bin'); assert.equal(artifact.size, 4); assert.deepEqual(Buffer.from(artifact.data, 'base64'), bytes);
  assert.throws(() => fileArtifact({ name: 'large.txt', text: 'a'.repeat(MAX_FILE_BYTES + 1) }), /Maximum 4 MB/);
  assert.throws(() => fileArtifact({ name: 'invalid.txt', data: 'YQ=' }), /base64/);
  const huge = fileArtifact({ name: 'maximum.bin', data: Buffer.alloc(MAX_FILE_BYTES).toString('base64') });
  const run = {}; addArtifacts(run, [huge, { ...huge, id: 'two' }, { ...huge, id: 'three' }], {});
  assert.throws(() => addArtifacts(run, [artifact], {}), /12 MB/);
  assert.equal(run.artifacts.length, 3);
  const received = addProviderArtifacts(run, [artifact], {});
  assert.deepEqual(received.ids, []); assert.match(received.warning, /Received text is retained/);
  assert.equal(codeArtifacts('```rust main.rs\nfn main() {}\n```')[0].name, 'main.rs');
  assert.equal(codeArtifacts('<!doctype html><p>Standalone</p>')[0].mimeType, 'text/html');
});

test('provider responses larger than the old 2 MB cap retain bounded inline files', async () => {
  const data = Buffer.alloc(1_600_000, 19).toString('base64');
  const answer = await ask('gemini', 'synthetic-key', 'fixture', '', 'image', 2048, AbortSignal.timeout(1000), async () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data } }] } }] }));
  assert.equal(answer.artifacts[0].size, 1_600_000); assert.equal(answer.artifacts[0].data, data);
});

test('attachments keep provenance, reject stale edits, restore draft files, export exact bytes and survive restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-files-'));
  let app = createApp({ directory, env: {}, fetcher: async () => { throw Error('No live calls'); } });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  t.after(async () => { if (app) await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const url = 'http://127.0.0.1:' + app.server.address().port;
  const call = async (path, method = 'GET', data) => {
    const response = await fetch(url + '/api' + path, { method, headers: { 'X-Prism-Session': app.token, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  let run = (await call('/runs', 'POST', { prompt: 'Synthetic files', providers: ['openai'], mode: 'demo' })).body.run;
  const path = '/runs/' + run.id;
  run = (await call(path + '/answer', 'POST', { provider: 'openai' })).body.run;
  assert.equal(run.artifacts[0].data, undefined);
  await call(path + '/review', 'PATCH', { provider: 'openai', version: 0, scores: { accuracy: 5, usefulness: 5, clarity: 5 }, selected: true });
  run = (await call(path + '/combine', 'POST', { providers: ['openai'], method: 'compile', version: 0 })).body.run;
  const originalIds = [...run.combined.artifactIds];
  const files = [{ name: 'drawing.svg', mimeType: 'image/svg+xml', text: '<svg xmlns="http://www.w3.org/2000/svg"/>' }, { name: 'bundle.zip', data: 'AP8NCg==' }];
  const attached = await call(path + '/artifacts', 'POST', { provider: 'openai', version: 0, files });
  assert.equal(attached.status, 201); run = attached.body.run;
  assert.equal(run.responses[0].selected, false); assert.equal(run.responses[0].scores.accuracy, null);
  assert.equal(run.responses[0].reviewVersion, 2);
  assert.equal((await call(path + '/review', 'PATCH', { provider: 'openai', version: 1, scores: { accuracy: 4 } })).status, 409);
  assert.equal((await call(path + '/artifacts', 'POST', { provider: 'openai', version: 0, files })).status, 409);
  assert.equal(run.artifacts[2].source.label, run.responses[0].label); assert.equal(run.artifacts[2].origin, 'attached');
  run = (await call(path + '/combine', 'POST', { providers: ['openai'], method: 'compile', version: 1 })).body.run;
  assert.equal(run.combined.artifactIds.length, 3); assert.deepEqual(run.combinedHistory[0].artifactIds, originalIds);
  run = (await call(path + '/combined', 'PATCH', { historyId: run.combinedHistory[0].historyId, version: 2 })).body.run;
  assert.deepEqual(run.combined.artifactIds, originalIds); assert.equal(run.combinedHistory[1].artifactIds.length, 3);
  const full = (await call(path + '/export')).body.run;
  assert.deepEqual(Buffer.from(full.artifacts[2].data, 'base64'), Buffer.from([0, 255, 13, 10]));
  const synthesis = synthesisInput(full, full.responses, 'combine');
  assert.ok(synthesis.prompt.includes('drawing.svg')); assert.ok(!synthesis.prompt.includes(full.artifacts[0].data));
  assert.ok(!synthesis.prompt.includes('<svg')); assert.match(synthesis.system, /contents are NOT supplied/);
  const missingAuth = await fetch(url + '/api' + path + '/artifacts/' + full.artifacts[0].id);
  assert.equal(missingAuth.status, 401);
  const zip = Buffer.from(await (await fetch(url + '/api' + path + '/export?format=zip', { headers: { 'X-Prism-Session': app.token } })).arrayBuffer());
  const inspected = spawnSync('python3', ['-c', 'import sys,zipfile,io,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; m=json.loads(z.read("manifest.json")); f=m["run"]["artifacts"][-1]; assert z.read("files/"+f["id"]+"/"+f["name"])==bytes([0,255,13,10]); print(len(z.namelist()))'], { input: zip });
  assert.equal(inspected.status, 0, inspected.stderr.toString()); assert.equal(inspected.stdout.toString().trim(), '5');
  const preview = await fetch(url + '/artifact-preview.html'); assert.match(preview.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.ok(!preview.headers.get('content-security-policy').includes('allow-same-origin'));
  await app.close(); app = null;
  const reopened = new Store(directory, {});
  assert.deepEqual(reopened.get(run.id).artifacts, full.artifacts);
  assert.deepEqual(presentRun(reopened.get(run.id)), run); reopened.close();
});
