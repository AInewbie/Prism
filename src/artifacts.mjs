import { randomUUID, createHash } from 'node:crypto';
import { AppError } from './core.mjs';

export const MAX_FILE_BYTES = 4_000_000;
export const MAX_RUN_BYTES = 12_000_000;
export const MAX_FILES = 32;
export const UPLOAD_BYTES = 6_000_000;
export const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts";
const types = { html: 'text/html', htm: 'text/html', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', ts: 'text/x-typescript', tsx: 'text/x-typescript', jsx: 'text/javascript', py: 'text/x-python', json: 'application/json', csv: 'text/csv', md: 'text/markdown', txt: 'text/plain', xml: 'text/xml', yaml: 'text/yaml', yml: 'text/yaml', sql: 'text/plain', sh: 'text/plain', pdf: 'application/pdf', zip: 'application/zip', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm' };
export function safeName(name = 'output.bin') {
  // Flat, portable names only. IDs in export paths disambiguate duplicate names.
  return String(name).split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'output.bin';
}
function mime(value, name) {
  const type = String(value || '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type) && type !== 'application/octet-stream'
    ? type : types[name.split('.').pop().toLowerCase()] || 'application/octet-stream';
}
export function fileArtifact(input, origin = 'attached') {
  if (!input || typeof input !== 'object') throw new AppError('Invalid file.');
  const name = safeName(input.name), mimeType = mime(input.mimeType, name);
  let bytes;
  if (typeof input.text === 'string') bytes = Buffer.from(input.text, 'utf8');
  else {
    if (typeof input.data !== 'string' || input.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
        (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data) || input.data.length % 4 !== 0))
      throw new AppError('Invalid or oversized base64 file. Maximum 4 MB per file.', 413);
    bytes = Buffer.from(input.data, 'base64');
    if (bytes.toString('base64') !== input.data) throw new AppError('Invalid base64 file.');
  }
  if (bytes.length > MAX_FILE_BYTES) throw new AppError('Maximum 4 MB per file.', 413);
  return { id: randomUUID(), name, mimeType, size: bytes.length, encoding: 'base64', data: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'), origin };
}
function referenceArtifact(id, name, mimeType, provider) {
  return { id: randomUUID(), name: safeName(name || 'provider-file'), mimeType: mime(mimeType, name || ''),
    size: null, encoding: 'reference', reference: { provider, id: String(id).slice(0, 2000) }, origin: 'provider-reference' };
}
export function codeArtifacts(text = '') {
  const files = [], aliases = { javascript: 'js', typescript: 'ts', python: 'py', markdown: 'md', shell: 'sh', bash: 'sh', '': 'txt' };
  const pattern = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm;
  for (const match of text.matchAll(pattern)) {
    const [language = '', filename] = match[2].trim().split(/\s+/), ext = aliases[language.toLowerCase()] || language.toLowerCase();
    if (files.length === MAX_FILES) break;
    files.push(fileArtifact({ name: filename || 'snippet-' + (files.length + 1) + '.' + (safeName(ext) || 'txt'), mimeType: types[ext] || 'text/plain', text: match[3] }, 'code-block'));
  }
  if (!files.length && /^\s*(?:<!doctype html\b|<html\b)/i.test(text))
    files.push(fileArtifact({ name: 'index.html', mimeType: 'text/html', text }, 'code-block'));
  return files;
}
export function providerArtifacts(id, data, answerText) {
  const artifacts = [], warnings = [];
  const add = (input) => {
    try { if (artifacts.length >= MAX_FILES) throw new AppError('Too many output files.'); artifacts.push(fileArtifact(input, 'provider-inline')); }
    catch { warnings.push('An output file was invalid or exceeded the 4 MB file limit and could not be saved.'); }
  };
  const ref = (value, name, type) => {
    if (!value) return;
    if (artifacts.length >= MAX_FILES) { warnings.push('Additional file references exceeded the file limit.'); return; }
    artifacts.push(referenceArtifact(value, name, type, id));
    warnings.push('A provider file reference needs a downloaded copy. Use Attach outputs to keep the actual file.');
  };
  if (id === 'gemini') {
    const interaction = (data.steps || []).filter(step => step.type === 'model_output').flatMap(step => step.content || []);
    for (const part of interaction.length ? interaction : data.candidates?.[0]?.content?.parts || []) {
      if (part.thought) continue;
      const inline = part.type === 'image' && part.data ? { data: part.data, mime_type: part.mime_type } : part.inlineData || part.inline_data,
        remote = part.fileData || part.file_data;
      if (inline) {
        const type = inline.mimeType || inline.mime_type;
        const ext = Object.keys(types).find(x => types[x] === type) || 'bin';
        add({ data: inline.data, mimeType: type, name: 'output-' + (artifacts.length + 1) + '.' + ext });
      }
      if (remote) ref(remote.fileUri || remote.file_uri, 'provider-file', remote.mimeType || remote.mime_type);
      if (part.executableCode) add({ name: 'generated-code.py', mimeType: 'text/x-python', text: part.executableCode.code });
      if (part.codeExecutionResult?.output) add({ name: 'execution-output.txt', text: part.codeExecutionResult.output });
    }
  } else if (id === 'openai' || id === 'grok') {
    for (const block of data.output || []) {
      if (block.type === 'image_generation_call' && typeof block.result === 'string') {
        const format = ['png', 'jpeg', 'webp'].includes(block.output_format) ? block.output_format : 'png';
        add({ name: 'generated-image-' + (artifacts.length + 1) + '.' + format, mimeType: 'image/' + format, data: block.result });
      }
      if (block.type === 'message') for (const content of block.content || [])
        for (const annotation of content.annotations || [])
          if (annotation.type === 'container_file_citation') ref(annotation.file_id, annotation.filename, '');
    }
  } else if (id === 'claude') {
    for (const block of data.content || []) {
      if (['image', 'document'].includes(block.type)) {
        if (block.source?.type === 'base64') add({ name: block.title || 'output.' + (block.type === 'image' ? 'png' : 'pdf'), mimeType: block.source.media_type, data: block.source.data });
        if (block.source?.type === 'file') ref(block.source.file_id, block.title, '');
      }
      if (['code_execution_tool_result', 'bash_code_execution_tool_result'].includes(block.type)) {
        const result = block.content;
        for (const item of (Array.isArray(result) ? result : result?.content || []))
          if (item.file_id) ref(item.file_id, item.filename, item.mime_type);
      }
    }
  }
  const snippets = codeArtifacts(answerText);
  if (artifacts.length + snippets.length > MAX_FILES) warnings.push('Some code blocks exceeded the file limit; their text is retained in the answer.');
  return { artifacts: [...artifacts, ...snippets].slice(0, MAX_FILES), warning: [...new Set(warnings)].join(' ') };
}
export function addArtifacts(run, files, source) {
  const all = run.artifacts || [];
  if (all.length + files.length > MAX_FILES || [...all, ...files].reduce((sum, f) => sum + (f.size || 0), 0) > MAX_RUN_BYTES)
    throw new AppError('This comparison reached its file limit (32 files or 12 MB). Start a new comparison.', 413);
  run.artifacts = [...all, ...files.map(f => ({ ...f, source: { ...source }, createdAt: new Date().toISOString() }))];
  return files.map(f => f.id);
}
export function addProviderArtifacts(run, files, source) {
  // A full file registry must not erase paid-for text that was received successfully.
  const ids = []; let omitted = 0;
  for (const file of files) {
    try { ids.push(...addArtifacts(run, [file], source)); }
    catch (error) { if (error.status !== 413) throw error; omitted++; }
  }
  return { ids, warning: omitted ? omitted + ' output file(s) could not be saved because this comparison reached its file limit (32 files / 12 MB). Received text is retained.' : '' };
}
export function presentRun(run) {
  return { ...run, artifacts: (run.artifacts || []).map(({ data, ...metadata }) => metadata) };
}
export function artifactsFor(run, owner) {
  const ids = new Set(owner.artifactIds || []);
  return (run.artifacts || []).filter(f => ids.has(f.id));
}
export function artifactManifest(run, owner) {
  return artifactsFor(run, owner).map(f => ({ name: f.name, mimeType: f.mimeType, size: f.size, available: f.encoding === 'base64', contentsIncluded: false }));
}
export function artifactMarkdown(run, owner) {
  const files = artifactsFor(run, owner);
  return files.length ? '\n\nFiles (included in ZIP / JSON export):\n' + files.map(f =>
    f.encoding === 'base64' ? '- [' + f.name + '](files/' + f.id + '/' + f.name + ') · ' + f.mimeType : '- ' + f.name + ' · provider reference only; file not downloaded').join('\n') : '';
}
