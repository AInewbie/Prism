import { inflateRawSync } from 'node:zlib';

export const MAX_APP_BUNDLE_ENTRIES = 200;
export const MAX_APP_BUNDLE_EXPANDED_BYTES = 20_000_000;
export const MAX_APP_SOURCE_ENTRY_BYTES = 1_000_000;
export const MAX_SYNTHESIS_APP_BUNDLES = 3;
export const MAX_APP_PREVIEW_BYTES = 2_000_000;

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const sourceExtensions = new Set([
  'css', 'csv', 'html', 'htm', 'js', 'jsx', 'json', 'md', 'mjs', 'py', 'sh',
  'sql', 'svg', 'ts', 'tsx', 'txt', 'xml', 'yaml', 'yml',
]);
const mimeByExtension = {
  css: 'text/css', csv: 'text/csv', html: 'text/html', htm: 'text/html', js: 'text/javascript',
  jsx: 'text/javascript', json: 'application/json', md: 'text/markdown', mjs: 'text/javascript',
  py: 'text/x-python', sh: 'text/plain', sql: 'text/plain', svg: 'image/svg+xml',
  ts: 'text/x-typescript', tsx: 'text/x-typescript', txt: 'text/plain', xml: 'text/xml',
  yaml: 'text/yaml', yml: 'text/yaml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm',
};

function blocked(message) {
  return { kind: 'zip-project', status: 'blocked', error: message, files: [], entryPoints: [] };
}

function safePath(bytes) {
  let name;
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\\', '/'); }
  catch { return { safe: false, path: 'Invalid UTF-8 filename' }; }
  const parts = name.split('/');
  const unsafe = !name || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name) ||
    name.length > 500 || parts.some(part => part === '..' || part === '.' || part.length > 240);
  return { safe: !unsafe, path: name };
}

function extension(path) {
  return path.split('/').pop().split('.').pop().toLowerCase();
}

function parse(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  let eocd = -1;
  for (let offset = bytes.length - 22, floor = Math.max(0, bytes.length - 65_557); offset >= floor; offset--)
    if (bytes.readUInt32LE(offset) === EOCD) { eocd = offset; break; }
  if (eocd < 0 || eocd + 22 > bytes.length) throw Error('not a supported ZIP archive');
  const disk = bytes.readUInt16LE(eocd + 4), centralDisk = bytes.readUInt16LE(eocd + 6);
  const diskEntries = bytes.readUInt16LE(eocd + 8), entries = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12), centralOffset = bytes.readUInt32LE(eocd + 16);
  if (disk || centralDisk || diskEntries !== entries) throw Error('multi-disk ZIP archives are not supported');
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff)
    throw Error('ZIP64 archives are not supported');
  if (entries > MAX_APP_BUNDLE_ENTRIES) throw Error('project contains more than 200 entries');
  if (centralOffset + centralSize > eocd || centralOffset > bytes.length) throw Error('invalid central directory');
  const files = []; let cursor = centralOffset, expanded = 0;
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== CENTRAL) throw Error('invalid central directory entry');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const crc32 = bytes.readUInt32LE(cursor + 16), compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42), end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff)
      throw Error('invalid or ZIP64 directory entry');
    const name = safePath(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const directory = name.path.endsWith('/');
    expanded += directory ? 0 : uncompressedSize;
    if (expanded > MAX_APP_BUNDLE_EXPANDED_BYTES) throw Error('expanded project exceeds the 20 MB inspection limit');
    if (!directory) {
      const ext = extension(name.path), encrypted = Boolean(flags & 1), supportedCompression = method === 0 || method === 8;
      files.push({ path: name.path, size: uncompressedSize, compressedSize,
        mimeType: mimeByExtension[ext] || 'application/octet-stream', readable: name.safe && !encrypted && supportedCompression && sourceExtensions.has(ext),
        safe: name.safe, encrypted, compression: method === 0 ? 'stored' : method === 8 ? 'deflate' : 'unsupported',
        entryPoint: name.safe && /(^|\/)(index\.html?|package\.json)$/i.test(name.path),
        _localOffset: localOffset, _flags: flags, _method: method, _crc32: crc32 } );
    }
    cursor = end;
  }
  if (cursor !== centralOffset + centralSize) throw Error('central directory length mismatch');
  return { bytes, files, entryCount: entries, expanded };
}

function publicFile(file) {
  const { _localOffset, _flags, _method, _crc32, ...visible } = file;
  return visible;
}

export function inspectAppBundle(bytes) {
  try {
    const parsed = parse(bytes), files = parsed.files.map(publicFile);
    return { kind: 'zip-project', status: 'ready', entryCount: parsed.entryCount,
      fileCount: files.length, totalUncompressedBytes: parsed.expanded,
      readableFileCount: files.filter(file => file.readable).length,
      unsafeEntryCount: files.filter(file => !file.safe).length,
      encryptedEntryCount: files.filter(file => file.encrypted).length,
      unsupportedEntryCount: files.filter(file => file.compression === 'unsupported').length,
      entryPoints: files.filter(file => file.entryPoint).map(file => file.path), files };
  } catch (error) {
    return blocked(error.message === 'expanded project exceeds the 20 MB inspection limit'
      ? error.message : 'Archive could not be inspected safely: ' + error.message + '.');
  }
}

function entryBytes(parsed, entry) {
  const offset = entry._localOffset;
  if (offset + 30 > parsed.bytes.length || parsed.bytes.readUInt32LE(offset) !== LOCAL) throw Error('invalid local file header');
  const nameLength = parsed.bytes.readUInt16LE(offset + 26), extraLength = parsed.bytes.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength, end = start + entry.compressedSize;
  if (end > parsed.bytes.length) throw Error('file data exceeds archive bounds');
  const compressed = parsed.bytes.subarray(start, end);
  const output = entry._method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, {
    maxOutputLength: Math.min(MAX_APP_SOURCE_ENTRY_BYTES, entry.size) + 1,
  });
  if (output.length !== entry.size) throw Error('expanded size mismatch');
  return output;
}

function previewBlocked(message) {
  return { status: 'blocked', error: message, entryPoint: null, resourcesInlined: 0 };
}

function localReference(reference, entryPoint) {
  const value = String(reference || '').trim();
  if (!value || value.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return null;
  try {
    const base = new URL(entryPoint, 'https://prism.invalid/');
    const resolved = new URL(value, base);
    if (resolved.origin !== 'https://prism.invalid') return null;
    return decodeURIComponent(resolved.pathname.slice(1));
  } catch { return null; }
}

function dataUrl(bytes, mimeType) {
  return 'data:' + mimeType + ';base64,' + bytes.toString('base64');
}

export function appBundlePreview(bytes) {
  let parsed;
  try { parsed = parse(bytes); }
  catch (error) { return previewBlocked('Archive could not be previewed safely: ' + error.message + '.'); }
  if (parsed.files.some(file => !file.safe || file.encrypted || file.compression === 'unsupported'))
    return previewBlocked('Preview is disabled because the archive contains an unsafe, encrypted or unsupported entry.');
  const entry = parsed.files.filter(file => /(^|\/)index\.html?$/i.test(file.path))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))[0];
  if (!entry) return previewBlocked('Preview needs a safe index.html or index.htm entry.');
  if (entry.size > MAX_APP_SOURCE_ENTRY_BYTES) return previewBlocked('The app entry point exceeds the 1 MB preview limit.');
  const files = new Map(parsed.files.map(file => [file.path, file]));
  let total = entry.size, resourcesInlined = 0;
  const read = (reference, from = entry.path) => {
    const path = localReference(reference, from), file = path && files.get(path);
    if (!file || file.size > MAX_APP_SOURCE_ENTRY_BYTES || total + file.size > MAX_APP_PREVIEW_BYTES) return null;
    try {
      const content = entryBytes(parsed, file);
      total += file.size; resourcesInlined++;
      return { content, file };
    } catch { return null; }
  };
  const rewriteCss = (css, from) => css.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi, (all, _quote, reference) => {
    const asset = read(reference, from);
    return asset ? 'url("' + dataUrl(asset.content, asset.file.mimeType) + '")' : all;
  });
  let html;
  try { html = new TextDecoder('utf-8', { fatal: true }).decode(entryBytes(parsed, entry)); }
  catch { return previewBlocked('The app entry point is not valid UTF-8 HTML.'); }
  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*(['"])(.*?)\2([^>]*)><\/script\s*>/gi,
    (all, before, _quote, reference, after) => {
      const asset = read(reference);
      if (!asset || !/^(?:text\/javascript|application\/javascript)$/.test(asset.file.mimeType)) return all;
      const source = asset.content.toString('utf8').replace(/<\/script/gi, '<\\/script');
      return '<script' + before + after + ' data-prism-source="' + asset.file.path.replaceAll('"', '&quot;') + '">' + source + '</script>';
    });
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = tag.match(/\brel\s*=\s*(['"])(.*?)\1/i)?.[2] || '';
    const reference = tag.match(/\bhref\s*=\s*(['"])(.*?)\1/i)?.[2];
    if (!/\bstylesheet\b/i.test(rel) || !reference) return tag;
    const asset = read(reference);
    if (!asset || asset.file.mimeType !== 'text/css') return tag;
    return '<style data-prism-source="' + asset.file.path.replaceAll('"', '&quot;') + '">' +
      rewriteCss(asset.content.toString('utf8'), asset.file.path).replace(/<\/style/gi, '<\\/style') + '</style>';
  });
  html = html.replace(/<(img|audio|video|source)\b[^>]*>/gi, (tag) =>
    tag.replace(/\b(src|poster)\s*=\s*(['"])(.*?)\2/gi, (attribute, name, quote, reference) => {
      const asset = read(reference);
      return asset ? name + '=' + quote + dataUrl(asset.content, asset.file.mimeType) + quote : attribute;
    }));
  return { status: 'ready', entryPoint: entry.path, resourcesInlined, expandedBytesIncluded: total, html,
    limitations: ['Network requests and external resources are blocked.', 'Dynamic imports, build steps and server features are unavailable.'] };
}

export function appBundleSources(bytes, budget) {
  let parsed;
  try { parsed = parse(bytes); }
  catch (error) { return { sources: [], excluded: [{ reason: error.message }] }; }
  const sources = [], excluded = [];
  for (const entry of parsed.files) {
    if (!entry.safe) { excluded.push({ path: entry.path, reason: 'unsafe path' }); continue; }
    if (entry.encrypted) { excluded.push({ path: entry.path, reason: 'encrypted entry' }); continue; }
    if (entry.compression === 'unsupported') { excluded.push({ path: entry.path, reason: 'unsupported compression' }); continue; }
    if (!entry.readable) continue;
    if (entry.size > MAX_APP_SOURCE_ENTRY_BYTES) { excluded.push({ path: entry.path, reason: 'source entry exceeds 1 MB' }); continue; }
    if (budget.included >= budget.maxFiles || budget.remaining <= 0) { excluded.push({ path: entry.path, reason: 'shared synthesis source limit reached' }); continue; }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(entryBytes(parsed, entry)); }
    catch { excluded.push({ path: entry.path, reason: 'invalid or non-UTF-8 source' }); continue; }
    const limit = Math.min(budget.maxPerFile, budget.remaining), content = text.slice(0, limit);
    budget.remaining -= content.length; budget.included++;
    sources.push({ path: entry.path, mimeType: entry.mimeType, size: entry.size,
      content, includedCharacters: content.length, truncated: content.length < text.length });
  }
  return { sources, excluded };
}
