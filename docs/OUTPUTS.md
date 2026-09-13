# Mixed outputs · Prism 0.5.0

An answer is now text plus output files. Compare and score the whole answer,
select it for a combined draft, and keep the original files with that draft.
The interface distinguishes provider output, extracted code, your attachments
and authored demo fixtures.

## Try it without setup

Open `demo/Prism-demo.html` directly in a browser. Compare the samples, inspect
`tiny-counter.html`, then choose **Run preview → Add one**. Inspect the sample
image or download the CSV. Selecting and assembling answers retains their files.
This offline demo uses fixed samples; it makes no model or network requests.
Existing saved demo sessions stay available, with their original text-only data.
Start a new comparison to see the mixed-output samples.

For your own outputs, run the full app with `node src/server.mjs` (Node 22.13+,
no installation or compilation), open the complete printed URL, and use
**Attach outputs** below a completed answer. Select files you downloaded from
that model. They are labelled **Added by you**, not attributed as an API return.
Attaching changes the reviewed answer, so its scores and selection reset; notes
and previously saved combined drafts stay intact. Files are append-only in this
version so a later edit cannot invalidate a saved draft's references.

## Format handling

| Output | Current behavior |
| --- | --- |
| Text and Markdown | Existing readable answer, scoring, notes and combination |
| Fenced code, JSON, CSV, text files | Escaped source preview and original download; all fenced languages preserved, with known MIME types where available |
| Images, including SVG | Browser image preview and exact-byte download; unsupported browser codecs show a download fallback |
| Single-file HTML / apps | Source first, then an explicit isolated interactive preview; original HTML downloadable |
| Audio / video | Native browser player when the MIME type and codec are supported; original download |
| PDF, Word, Excel, PowerPoint and other binary files | Preserved as attachments and downloadable; no office-document rendering or PDF viewer in this version |
| ZIP / multi-file app projects | Preserved and downloadable as the original archive; not unpacked, installed or executed by Prism |
| Provider-hosted file references | Metadata retained with **Not downloaded**; attach the actual downloaded file for preview/export |

### Provider coverage

The adapters handle compatible output blocks and now expose an explicit
**Generated image + optional text** comparison mode for OpenAI and Gemini.

- OpenAI Responses: text, image-generation result bytes and container-file
  citation references. Visual mode enables the configured image-generation tool
  and forces that tool choice; the mainline text model stays separately configured.
- Gemini generateContent handles visible text, inline media, file references,
  executable-code blocks and execution-result text. Thought parts are excluded.
  Visual mode uses the Interactions endpoint with the configured image model and
  requests both text and image formats.
- Grok Responses: text/code handling and compatible output blocks. xAI's
  separate image/video endpoints are not invoked by this release.
- Claude Messages: text/code, compatible inline image/document content and
  code-execution file references. File download and code-execution tools are
  not automatically enabled.
- Files created in provider chat websites can be attached after download.
  Prism does not scrape those websites or reuse their subscription sessions.

Live provider calls have not been made for this milestone. Contract fixtures
verify parsing, not live model availability, output quality or billing.

## Combining and export

Compilation and synthesis keep references to all files in selected answers.
The combined editor and saved revision preview show those files. Restoring a
revision restores its file selection without duplicating or deleting bytes.

**AI synthesis currently receives text plus file names/types/sizes, scores and
notes. It does not receive file bytes or inspect images.** Its instructions
explicitly prohibit claiming to have evaluated or merged file contents. The
files are kept beside the combined text; this is not an image, video or app
merging engine. The request preview shows the same file manifest.

- **Download** gets one exact original file.
- **Export files ZIP** contains `comparison.md`, a metadata `manifest.json`
  and each saved file under `files/<id>/<name>`. IDs disambiguate duplicate names.
- **Export JSON** includes file bytes as base64 plus provenance and all draft
  references. The existing JSON import checkpoint is separate unfinished work.
- **Export Markdown** lists files and relative paths; download the ZIP when you
  need working file links alongside the Markdown.

The native MCP widget retains file metadata and shows counts. Rich previews and
file downloads are currently available in the browser app, not the MCP widget.
Widget JSON export contains metadata only and is explicitly labelled as such;
use the browser export for actual bytes. Plugin and browser workspaces remain
separate by default.

## Storage, isolation and limits

No runtime dependency was added. File bytes remain in the private server
workspace, outside the repository. Existing version-1 workspaces load unchanged;
absent file arrays mean a text-only answer. The same atomic writes, credential
handling and workspace lock still apply. Keep backups of existing workspaces.

Files are stored once in `run.artifacts`; answers and draft revisions refer to
immutable IDs. Ordinary API/MCP reads return metadata only. Authenticated
on-demand reads supply selected file bytes, avoiding retransfer on every score.
Providers never receive a file just because it was previewed or downloaded.

- Maximum 4 MB per file, 32 files and 12 MB of decoded files per comparison.
- Browser upload: at most 8 files totalling 4 MB per operation.
- Provider JSON responses: at most 18 MB; model-list responses retain their 2 MB cap.
- Workspace JSON: existing 40 MB cap. Storage-full errors retain prior saved state.
- File-limit failures preserve received answer text and report omitted files.
- Source preview displays at most 200,000 characters; downloads retain the full file.

Generated HTML starts as inert source. **Run preview** creates an iframe with
`sandbox="allow-scripts"` and no same-origin, form, popup, download or top-navigation
permission. Its response CSP separately blocks network requests, external
resources and nested frames; the parent restricts frame navigation to its own
origin. Provider keys, session tokens and other answers are never sent to the
preview. The preview endpoint only serves a fixed loader. Browser sign-in and
all file API routes remain authenticated; the loader has no workspace access.
The offline demo applies equivalent iframe restrictions and no-network policies.
Downloads are original files; opening them outside Prism uses the destination
application's normal permissions. CPU-heavy app code can still make its browser
tab unresponsive; this is not a resource-metered code runner.

## Extend the output model

`src/artifacts.mjs` owns file validation, provider extraction, limits, metadata
and draft references. `public/artifacts.js` owns MIME-based viewers; it is shared
with the offline demo by `npm run sync:html-demo`. `src/zip.mjs` packages bytes
without executing or interpreting them. Add new provider output blocks through
these modules, with fixture coverage and clear reference/download semantics.
Do not introduce arbitrary URL fetches or execute generated apps on the server.

## Verification

Run `npm test` and `npm run check`. Browser setup follows
[BROWSER_ACCESS.md](BROWSER_ACCESS.md). Then:

```sh
npm run test:outputs
npm run test:html-demo
PRISM_TEST_BROWSER_GATEWAY=1 npm run test:browser
```

Tests use disposable synthetic workspaces and fixture files, no paid API calls.
The output suite exercises app interactions, parent/storage/API/network isolation,
image preview, attachment upload over the old request limit, exact file downloads,
combined files, ZIP export and reload at desktop/phone widths. Unit/API tests
also check all adapters, malformed/oversized data, stale reviews, file provenance,
draft restore, ZIP CRC integrity with Python's independent reader, and restart
persistence. Python 3 is needed for that independent ZIP verification.

## Sources consulted

Official API references accessed 14 September 2026 (living documentation):

- [OpenAI image-generation tool](https://developers.openai.com/api/docs/guides/tools-image-generation): configured Responses tool, forced tool choice, and returned image bytes.
- [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation): Interactions request and text+image response format.
- [Claude Files API](https://platform.claude.com/docs/en/build-with-claude/files): generated-file references and separate authenticated downloads.
- [xAI image generation](https://docs.x.ai/developers/model-capabilities/images/generation): separate generation endpoint and base64 output format.
- [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe): origin isolation and explicit sandbox permissions. Browser tests verify the actual policy used here; this is not a comprehensive security certification.
