const artifactEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function outputKind(file) {
  if (file.encoding === 'reference') return 'Reference';
  if (file.appBundle) return 'App bundle';
  if (file.mimeType === 'text/html') return 'HTML / app';
  if (/^image\//.test(file.mimeType)) return 'Image';
  if (/^audio\//.test(file.mimeType)) return 'Audio';
  if (/^video\//.test(file.mimeType)) return 'Video';
  if (/^(text\/|application\/(json|javascript|xml))/.test(file.mimeType)) return 'Text / code';
  return 'Attachment';
}
export function outputList(files, { blind = false } = {}) {
  if (!files.length) return '';
  return '<section class="output-list" aria-label="Output files"><div class="output-heading">OUTPUT FILES <span>' + files.length + '</span></div>' + files.map((file, i) => {
    const kind = outputKind(file), title = blind ? 'File ' + (i + 1) : file.name;
    const bundle = file.appBundle?.status === 'ready' ? ' · ' + file.appBundle.fileCount + ' project files' : '';
    return '<div class="output-item"><span class="output-kind">' + artifactEscape(kind) + '</span><div class="output-description"><strong>' + artifactEscape(title) + '</strong><small>' + artifactEscape(file.mimeType) + ' · ' + (file.size === null ? 'Not downloaded' : file.size < 1000 ? file.size + ' B' : (file.size / 1000).toFixed(1) + ' KB') + bundle + ' · ' + (file.origin === 'attached' ? 'Added by you' : file.origin === 'demo' ? 'Sample file' : file.origin === 'code-block' ? 'From answer code' : 'Provider output') + '</small></div><div class="output-actions">' + (kind !== 'Reference' ? '<button class="button" data-output-open="' + file.id + '">Inspect<span class="sr-only"> ' + artifactEscape(title) + '</span></button><button class="button" data-output-download="' + file.id + '">Download<span class="sr-only"> ' + artifactEscape(title) + '</span></button>' : '<span class="quiet">Attach the downloaded file</span>') + '</div></div>';
  }).join('') + '</section>';
}
export function outputBytes(file) {
  const raw = atob(file.data);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
export function saveOutput(file) {
  const blob = new Blob([outputBytes(file)], { type: file.mimeType }), url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function createOutputViewer({ offline = false } = {}) {
  const dialog = document.createElement('dialog'); dialog.className = 'output-dialog'; dialog.setAttribute('aria-label', 'Inspect output');
  dialog.innerHTML = '<div class="output-dialog-head"><div><h2></h2><p class="quiet"></p></div><button class="button" data-close>Close</button></div><div class="output-view-actions"><button class="button" data-source>View source</button><button class="button" data-run>Run preview</button><button class="button" data-download>Download file</button></div><p class="output-preview-note" hidden>Isolated preview · External resources and server features are unavailable. Download to use the full file.</p><div class="output-preview"></div>';
  document.body.append(dialog);
  let file, urls = [], restoreFocus;
  const body = dialog.querySelector('.output-preview'), note = dialog.querySelector('.output-preview-note');
  const cleanup = () => { body.replaceChildren(); urls.forEach(url => URL.revokeObjectURL(url)); urls = []; };
  const urlFor = (content, type) => { const url = URL.createObjectURL(new Blob([content], { type })); urls.push(url); return url; };
  function source() {
    cleanup(); note.hidden = true;
    const pre = document.createElement('pre'); pre.textContent = new TextDecoder().decode(outputBytes(file)).slice(0, 200000);
    body.append(pre);
    if (file.size > 200000) { const notice = document.createElement('p'); notice.textContent = 'Source preview limited to 200,000 characters. Download for the complete file.'; body.prepend(notice); }
  }
  function preview() {
    cleanup(); note.hidden = false;
    const frame = document.createElement('iframe'); frame.title = 'Isolated app preview'; frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer';
    const html = new TextDecoder().decode(outputBytes(file));
    if (offline) {
      const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
      frame.src = urlFor('<!doctype html><meta http-equiv="Content-Security-Policy" content="' + csp + '">' + html, 'text/html');
    } else {
      frame.src = '/artifact-preview.html';
      frame.addEventListener('load', () => frame.contentWindow.postMessage({ type: 'prism-preview', html }, '*'), { once: true });
    }
    body.append(frame);
  }
  function bundleManifest() {
    cleanup(); note.hidden = true;
    const bundle = file.appBundle, intro = document.createElement('p');
    if (bundle.status !== 'ready') {
      intro.textContent = bundle.error || 'This archive could not be inspected safely. The original file is still preserved.';
      body.append(intro); return;
    }
    intro.textContent = bundle.fileCount + ' files · ' + bundle.totalUncompressedBytes.toLocaleString() +
      ' expanded bytes · ' + bundle.readableFileCount + ' readable source files. Nothing was extracted or executed.';
    body.append(intro);
    if (bundle.entryPoints?.length) {
      const entry = document.createElement('p'); entry.className = 'bundle-entry-points';
      entry.textContent = 'Likely entry points: ' + bundle.entryPoints.join(', '); body.append(entry);
    }
    const list = document.createElement('ul'); list.className = 'bundle-file-list';
    for (const item of bundle.files || []) {
      const row = document.createElement('li'), path = document.createElement('code'), meta = document.createElement('span');
      path.textContent = item.path; meta.textContent = item.safe
        ? item.size.toLocaleString() + ' B · ' + (item.readable ? 'readable source' : item.mimeType)
        : 'excluded · unsafe path';
      row.append(path, meta); list.append(row);
    }
    body.append(list);
    if (bundle.unsafeEntryCount || bundle.encryptedEntryCount || bundle.unsupportedEntryCount) {
      const warning = document.createElement('p'); warning.className = 'output-preview-note'; warning.textContent =
        'Excluded: ' + bundle.unsafeEntryCount + ' unsafe paths, ' + bundle.encryptedEntryCount +
        ' encrypted entries, ' + bundle.unsupportedEntryCount + ' unsupported compression entries.'; body.append(warning);
    }
  }
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { cleanup(); restoreFocus?.focus?.({ preventScroll: true }); });
  dialog.querySelector('[data-source]').onclick = source;
  dialog.querySelector('[data-run]').onclick = preview;
  dialog.querySelector('[data-download]').onclick = () => saveOutput(file);
  return { open(next, title = next.name) {
    file = next; restoreFocus = document.activeElement; cleanup(); note.hidden = true;
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('.quiet').textContent = outputKind(file) + ' · ' + file.mimeType;
    dialog.querySelector('[data-source]').hidden = !['HTML / app', 'Text / code'].includes(outputKind(file)) && file.mimeType !== 'image/svg+xml';
    dialog.querySelector('[data-run]').hidden = file.mimeType !== 'text/html';
    const kind = outputKind(file);
    if (kind === 'App bundle') bundleManifest();
    else if (['HTML / app', 'Text / code'].includes(kind)) source();
    else if (['Image', 'Audio', 'Video'].includes(kind)) {
      const node = document.createElement(kind === 'Image' ? 'img' : kind.toLowerCase());
      if (kind === 'Image') node.alt = title; else { node.controls = true; node.preload = 'metadata'; }
      node.src = urlFor(outputBytes(file), file.mimeType);
      node.addEventListener('error', () => { const p = document.createElement('p'); p.textContent = 'This browser cannot preview this format. Download the original file.'; body.append(p); }, { once: true });
      body.append(node);
    } else { const p = document.createElement('p'); p.textContent = 'Original attachment preserved. Download to open it in a compatible app. ZIP projects and office documents are not executed here.'; body.append(p); }
    if (!dialog.open) dialog.showModal();
  }, close() { dialog.close(); } };
}
