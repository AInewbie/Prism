import test from 'node:test';
import assert from 'node:assert/strict';
import { fileArtifact, addArtifacts } from '../src/artifacts.mjs';
import { synthesisInput } from '../src/core.mjs';
import { inspectAppBundle, appBundlePreview, appBundleSources, MAX_APP_BUNDLE_EXPANDED_BYTES } from '../src/app-bundles.mjs';
import { zipFiles } from '../src/zip.mjs';

function projectZip() {
  return zipFiles([
    ['index.html', '<!doctype html><main id="app"></main><script src="src/app.js"></script>'],
    ['src/app.js', 'document.querySelector("#app").textContent = "Ready";'],
    ['styles/site.css', 'main { color: seagreen; }'],
    ['assets/pixel.png', Buffer.from([137, 80, 78, 71])],
  ]);
}

test('ZIP app bundles expose a bounded non-executing project manifest', () => {
  const bytes = projectZip(), inspected = inspectAppBundle(bytes);
  assert.equal(inspected.status, 'ready');
  assert.equal(inspected.fileCount, 4);
  assert.equal(inspected.readableFileCount, 3);
  assert.deepEqual(inspected.entryPoints, ['index.html']);
  assert.equal(inspected.files.find(file => file.path === 'src/app.js').readable, true);
  assert.equal(inspected.files.find(file => file.path === 'assets/pixel.png').readable, false);
  assert.ok(!JSON.stringify(inspected).includes('_localOffset'));
});

test('self-contained ZIP web apps get a bounded isolated-preview document', () => {
  const preview = appBundlePreview(projectZip());
  assert.equal(preview.status, 'ready');
  assert.equal(preview.entryPoint, 'index.html');
  assert.equal(preview.resourcesInlined, 1);
  assert.match(preview.html, /data-prism-source="src\/app\.js"/);
  assert.match(preview.html, /querySelector/);
  assert.ok(!preview.html.includes('src="src/app.js"'));
  assert.match(preview.limitations.join(' '), /Network requests/);

  const noEntry = appBundlePreview(zipFiles([['main.js', 'console.log("no html")']]));
  assert.equal(noEntry.status, 'blocked');
  assert.match(noEntry.error, /index\.html/);
});

test('ZIP app source is supplied only by explicit opt-in and shares synthesis limits', () => {
  const artifact = fileArtifact({ name: 'candidate-app.zip', mimeType: 'application/zip', data: projectZip().toString('base64') });
  const run = { prompt: 'Compare the generated apps', instructions: '', artifacts: [] };
  addArtifacts(run, [artifact], {});
  const answer = { label: 'A', text: 'A small browser app.', artifactIds: [artifact.id], scores: {}, notes: '' };
  const metadata = synthesisInput(run, [answer], 'Prefer clarity');
  const metadataPayload = JSON.parse(metadata.prompt), metadataFile = metadataPayload.candidates[0].files[0];
  assert.equal(metadataPayload.appBundlePolicy.mode, 'metadata-only');
  assert.equal(metadataFile.appBundle.fileCount, 4);
  assert.equal(metadataFile.appSources, undefined);
  assert.ok(!metadata.prompt.includes('document.querySelector'));

  const included = synthesisInput(run, [answer], 'Prefer clarity', { includeAppSources: true });
  const payload = JSON.parse(included.prompt), file = payload.candidates[0].files[0];
  assert.equal(payload.appBundlePolicy.mode, 'bounded-readable-project-sources');
  assert.equal(payload.appBundlePolicy.archivesExecutedOrExtracted, false);
  assert.equal(included.appSourceFiles, 3);
  assert.match(file.appSources.find(source => source.path === 'src/app.js').content, /querySelector/);
  assert.ok(!file.appSources.some(source => source.path.endsWith('.png')));
  assert.ok(!included.prompt.includes(artifact.data));
  assert.match(included.system, /never execute, install/);
});

test('unsafe paths and oversized expanded archives are blocked without extraction', () => {
  const unsafe = Buffer.from(zipFiles([['safe.txt', 'do not include']]));
  const central = unsafe.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  Buffer.from('../x.txt').copy(unsafe, central + 46);
  const inspected = inspectAppBundle(unsafe);
  assert.equal(inspected.status, 'ready');
  assert.equal(inspected.unsafeEntryCount, 1);
  const source = appBundleSources(unsafe, { remaining: 1000, included: 0, maxFiles: 12, maxPerFile: 1000 });
  assert.equal(source.sources.length, 0);
  assert.match(source.excluded[0].reason, /unsafe path/);
  assert.equal(appBundlePreview(unsafe).status, 'blocked');

  const oversized = Buffer.from(zipFiles([['safe.txt', 'small']]));
  const oversizedCentral = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  oversized.writeUInt32LE(MAX_APP_BUNDLE_EXPANDED_BYTES + 1, oversizedCentral + 24);
  const blocked = inspectAppBundle(oversized);
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.error, /20 MB/);
});
