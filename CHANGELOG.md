# Changelog

## 0.10.0 — 14 September 2026 · isolated static app-bundle previews

- Run compatible self-contained ZIP web apps from a safe `index.html` entry in
  the existing origin-isolated, network-blocked preview iframe.
- Inline bounded local classic scripts, stylesheets, images, audio and video in
  memory; keep external resources, dynamic imports, build steps and servers off.
- Refuse previews for unsafe paths, encrypted entries, unsupported compression,
  missing entry points or preview data over the 2 MB expanded budget.
- Keep ZIP archives inert until the user explicitly selects **Run preview**;
  never extract, install or execute project contents on the server.
- Preserve v0.9 manifests, bounded source synthesis, exact downloads, history,
  exports and all earlier text, image, PDF, audio and video behavior.
- Verify 48 automated tests plus desktop, phone, offline-demo, browser-login and
  native-widget workflows. No provider call, charge, merge or deployment.

## 0.9.0 — 14 September 2026 · safe multi-file app inspection

- Inspect ZIP project structure, likely entry points, file types and declared
  expanded size in the browser without extracting, installing or executing it.
- Add a separate, default-off choice to send bounded readable source from up to
  3 selected ZIP projects to the synthesis model.
- Reject or exclude unsafe paths, encrypted entries, unsupported compression,
  ZIP64, invalid directories, projects over 200 entries and projects declaring
  more than 20 MB expanded data.
- Share the existing 12-file / 60,000-character synthesis budget between direct
  files and project sources; keep binary entries and archive base64 out of the
  exact preview.
- Preserve original ZIP downloads, attachments, sessions, draft history and all
  v0.8 output modes. Record project-source use with the saved combined draft.
- Verify unit/API safety cases plus desktop and phone app-bundle inspection,
  source preview, synthesis, export and reload. No live provider call, charge,
  merge, deployment or physical Samsung test was performed.

## 0.8.0 — 14 September 2026 · bounded PDF synthesis

- Add a separate, default-off choice to send PDF attachments from selected
  answers to the synthesis model for text-and-page understanding.
- Use native PDF input blocks for OpenAI Responses, Gemini generateContent and
  Claude Messages. Block Grok before a call when PDF inspection is enabled.
- Cap disclosure at 3 PDFs, 4 MB each and 8 MB decoded total; require a PDF
  signature and mark included or excluded documents in the exact preview.
- Keep PDF base64 bytes out of the browser preview while showing names, sizes,
  types and source labels. Treat PDFs as untrusted documents and record the
  document-input mode with each saved combined draft.
- Preserve existing sessions, attachments, image/source synthesis, exports,
  credentials and metadata-only defaults. No local PDF execution or extraction.
- Verify 44 automated tests, including fixture-only PDF dispatch, plus desktop
  and phone rich-output workflows. No
  live provider call, charge, merge, deployment or physical Samsung test was
  performed.

## 0.7.0 — 14 September 2026 · bounded visual synthesis

- Add a separate, default-off choice to send compatible images from selected
  answers to the synthesis model for visual comparison and consolidation.
- Use native multimodal request blocks for OpenAI Responses, Gemini Interactions
  and Claude Messages. Block Grok before a call when visual inputs are enabled.
- Accept PNG, JPEG and WebP inputs only; cap disclosure at 6 images, 4 MB each
  and 8 MB decoded total. Mark included and excluded images in the preview.
- Keep raw base64 image bytes out of the browser payload preview while showing
  names, MIME types, sizes and source-answer labels. Treat images as untrusted
  visual data and record the visual-input mode with each saved combined draft.
- Preserve existing sessions, generated-image comparisons, readable-file
  synthesis, compilation, exports, credentials and metadata-only defaults.
- Verify 41 automated tests plus desktop and phone rich-output workflows. No
  live provider call, charge, merge, deployment or physical Samsung test was
  performed.

## 0.6.0 — 14 September 2026 · bounded source-aware synthesis

- Add an explicit, default-off choice to send bounded UTF-8 text, code, CSV,
  JSON and HTML artifact contents to the selected synthesis provider.
- Show the exact server-generated system instruction and structured synthesis
  payload before the call. Identify every included, truncated and excluded file.
- Cap disclosure at 12 files, 20,000 characters per file and 60,000 characters
  total. Keep images and every other binary/unsupported output metadata-only.
- Treat included source as untrusted data, never instructions, and never execute
  it during synthesis. Record the selected file-content mode with saved drafts.
- Keep existing sessions, files, credentials, provider adapters, output modes,
  compilation and default metadata-only behavior backward-compatible.
- Verify 39 automated tests plus full desktop/phone browser, rich-output, native
  widget and direct-open HTML demo workflows. No live provider call, merge,
  deployment, charge or physical Samsung test was performed.

## 0.5.0 — 14 September 2026 · explicit visual requests

- Add an explicit output selector for text/code/files or generated image with
  provider text when available. Visual mode compares OpenAI and Gemini and
  visibly excludes providers whose image-generation path is not implemented.
- Keep separate text and image model IDs in Connections without changing stored
  keys or existing sessions. Validate provider capabilities before any API call.
- Use OpenAI's Responses image-generation tool with a forced tool choice and
  Gemini's Interactions API with text+image response formats. Preserve returned
  image bytes through the existing preview, scoring, draft history and exports.
- Keep text behavior, synthesis and the native widget backward-compatible; the
  widget currently starts text/code/file comparisons only.
- Verify 38 automated tests and desktop/phone browser rich-output workflows,
  including visual-mode provider gating and preserved artifacts. Live provider
  calls, output quality, actual charges and physical Samsung use remain unverified.

## 0.4.0 — 14 September 2026 · mixed outputs

- Retain typed output files, provenance, exact bytes and immutable IDs alongside
  answer text; preserve old sessions without a migration or credential change.
- Extract fenced code and supported provider inline media/file references.
  File-only supported responses succeed; malformed media has an explicit warning.
- Add file upload, image/source/media viewers, isolated interactive HTML preview,
  exact downloads and ZIP export. Unsupported binary formats remain downloadable.
- Keep source files with combined drafts and restored history without repeated
  binary storage. Text synthesis receives metadata only, with that limit visible.
- Reset reviews for newly attached content; reject stale attachments/reviews.
  Keep received text when a comparison reaches its output-file limit.
- Share output viewers and sample files with the direct-open HTML demo. No runtime
  dependency added. Native widget shows file counts; browser handles rich previews.
- Verify 35 automated tests, full signed-in desktop/phone regression workflows,
  mixed-output browser checks and direct-open HTML demo checks. Add
  provider/schema, file-validation, export/CRC, persistence and browser isolation coverage. Live providers, physical Samsung, native account installation
  and production hosting remain unverified/unperformed.

## 0.3.2 — 14 September 2026 · searchable sessions

- Search saved session titles, combine Demo/Live filters, see result counts and
  reset without changing the current comparison or unfinished prompt.
- Add Ctrl/⌘K search focus and readable phone history with larger touch controls.
- Share matching logic with the downloadable offline demo through a small
  dependency-free module and a reproducible inline packaging script.
- Preserve existing sessions, scoring, draft history, connections and API behavior.
- Verify 29 automated tests, full browser workflows, desktop/phone history search
  and direct-open HTML demo use without provider calls.

## Offline HTML demo — 14 September 2026

- Add one self-contained HTML file for trying Prism without installation,
  compilation, a server or network requests.
- Preserve the core compare, score, select, combine, edit, browser-save and JSON
  export experience using clearly labelled fixed samples only.

## Repository publication — 13 September 2026

- Set the owner-supplied AInewbie/Prism repository as the source destination and
  add clone instructions. Application behavior and the verified 0.3.1 release
  remain unchanged.

## 0.3.1 — 13 September 2026 · browser access preview

- Add a stable browser address with password sign-in and sign-out, reusing the
  existing comparison interface and private API without a compilation step.
- Add bounded, expiring HttpOnly cookie sessions; explicit trusted origin/Host
  checks, Secure cookies for configured HTTPS, logout revocation and restart
  reauthentication. Keep internal launch tokens outside the browser.
- Keep browser-access data separate by default and require server opt-in for
  provider access. Preserve standalone and native-plugin entry points.
- Add authentication/API regression coverage and run the existing desktop/phone
  comparison workflow through browser sign-in. No live model calls, actual HTTPS
  hosting, physical Samsung tests or production deployment are claimed.
- Passed 27 automated tests and syntax checks, plus browser sign-in → compare →
  score → combine → save/export/reload → sign-out/sign-in at 1600×1050 and
  412×1050 touch with synthetic data. Native MCP tests remain in the passing suite.

## 0.3.0 — 13 September 2026 · native plugin preview

- Add a private stdio MCP server and embedded interface for comparison, manual
  scores/notes, blind review, source selection, compilation, provider synthesis,
  editable drafts, saved sessions, revision restoration and JSON export.
- Reuse the standalone 0.2.0 API and persistence modules; preserve the prior
  standalone UI. Plugin and local-preview data are separate by default.
- Disable live calls by default. Require server opt-in and explicit per-call
  acknowledgement, keep credentials outside MCP inputs/results, and persist
  comparison request IDs to avoid replaying the same request after reconnect.
- Include a demo-only local host, MCP/browser regression tests, dependency lock,
  environment template, plugin descriptor and private-tunnel setup guide.
- Passed 21 automated tests, JavaScript syntax checks and the embedded browser
  workflow at 1160×1100 and 412×1100 touch: compare, save human reviews, blind
  review, compile, edit/save, restore, export, reopen and escape untrusted text.
- Locally verified protocol and UI; **not connected to ChatGPT**. Tunnel setup,
  actual host rendering/approvals, real provider calls and physical Samsung use
  remain unverified. No deployment, public listing or remote push performed.

## 0.2.0 — 13 September 2026

- Keep previous saved combined answers when editing, assembling or synthesizing.
- Preview and explicitly restore revisions; restoration also keeps the displaced
  draft, with monotonically increasing versions and original source metadata.
- Include draft history in JSON and Markdown exports. Existing 0.1.0 sessions
  gain history on their next change without a migration command.
- Block restoration while typing remains unsaved; reject stale restore requests.
  Failed synthesis and invalid restoration leave the current draft intact.
- Passed 14 automated tests and desktop/phone-sized browser workflows including
  replacement, preview, restore, exports and reload. No paid provider calls.

## 0.1.0 — 13 September 2026

First commissioned version of Prism, a standalone model comparison GUI.

- One prompt and common instructions, dispatched concurrently to selected
  OpenAI, Gemini, xAI and Anthropic models.
- Clearly labelled demo mode with no keys or API calls.
- Saved sessions, responsive comparison, randomized answer labels and blind review.
- Manual accuracy/usefulness/clarity scores, notes and sortable scorecard.
- Selected-answer compilation, optional provider synthesis, editable final draft,
  JSON/Markdown exports.
- Local API-key entry, optional JSON persistence and model discovery.
- Independent failure states, output warnings, cancellation, no automatic retries,
  stale review checks, atomic persistence and local-server authentication.
- Passed 12 tests and desktop/phone-sized browser workflows. Live provider calls
  and physical Samsung testing remain unverified.

This release supersedes no VolModel version; it is a separate project.
