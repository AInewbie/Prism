# Prism — model comparison studio

**Version 0.3.1 · browser sign-in preview · 13 September 2026**

Send one prompt to OpenAI (ChatGPT models through the API), Gemini, Grok and
Claude. Compare the answers, score them yourself and combine selected answers
into an editable result. This is a separate application from VolModel.

## New: normal browser sign-in

Prism can now use a stable address and a workspace password, with no rotating
launch token in the link. Once a server operator hosts it, users just open the
address and sign in. **This preview is locally tested, not deployed**; there is
no live website URL yet. See [browser setup and verification](docs/BROWSER_ACCESS.md).

For a local trial, set a unique `PRISM_BROWSER_PASSWORD` in `.env` as described
there, then run `node src/browser-server.mjs` and open http://127.0.0.1:8797.
No compilation or dependency installation is needed for the browser server.
Provider calls are disabled until the operator explicitly enables them. Browser
data is separate by default, preserving the delivered standalone/plugin versions.

## Native ChatGPT interface (0.3.0 preview)

The native MCP plugin is implemented and locally tested, **not yet connected to
your ChatGPT account**. It includes an embedded GUI for comparing answers, manual
scores and notes, blind review, synthesis, saved sessions and combined-draft history.
The standalone app below remains available and its existing data is untouched.

To try the embedded GUI locally, extract this package and run:

```sh
cd prism
npm ci
npm run preview:plugin
```

Open the complete localhost URL printed in the terminal. This demo-only test host
is not ChatGPT and makes no provider calls. For actual ChatGPT use, follow
[Connect Prism to ChatGPT](docs/CHATGPT_PLUGIN.md): start the private stdio server
through Secure MCP Tunnel and register it in developer mode. Your account/tunnel
setup is the remaining connection step, not an installation already performed.

## Try the standalone app

Install **Node 22.13 or newer**, extract this package, then run:

```sh
cd prism
node src/server.mjs
```

Open the **complete localhost URL** printed by the terminal, including its
session fragment. Leave the terminal running. Press Ctrl+C to stop.

No npm install, compilation, cloud account or API key is needed for **Demo**.
Click **Try an example → Compare answers**. Demo responses are fixed local
fixtures, clearly labelled; they are not generated answers or measurements of
the providers' quality.

Windows: run the same Node command in PowerShell.
Samsung/Android: install Termux from its official distribution, run the command
below, extract the folder, and use the same Node launch command inside it.
Physical Samsung testing has not been performed.

```sh
pkg install nodejs-lts
```

Default port: 8795. To use a separate preview data directory or port:

```sh
PRISM_PORT=8796 PRISM_DATA_DIR="$HOME/.local/share/prism-preview" node src/server.mjs
```

PowerShell:

```powershell
$env:PRISM_PORT = "8796"
$env:PRISM_DATA_DIR = "$HOME\prism-preview-data"
node src/server.mjs
```

## Use real models

1. Open **Connections**.
2. Enter each provider's API key. Leave **Remember on device** off to keep the key
   in server memory until shutdown, or enable it for persistence.
3. **Save connection**, then **Load models**. Choose a text-generation model ID
   available to your account and save again. You can also enter an ID manually.
   Model listing can include non-text models; Gemini's list is filtered for
   generateContent support. No model availability is presumed.
4. Start a **New comparison**, select **Live**, choose providers and submit.
   The same prompt, common instructions and output limit go to all selected
   providers. Each answer appears independently.
5. API use is billed by the providers. Your chat website login/subscription is
   not the credential used by this app. Opening the workspace and saving keys
   do not call any provider.

Live provider calls were **not made during development**. Adapters and the live
HTTP path were tested with simulated provider responses. Real account access,
billing, model behavior and provider limits need verification with your own keys.

Optional environment keys are read at startup: OPENAI_API_KEY, GEMINI_API_KEY,
XAI_API_KEY, ANTHROPIC_API_KEY. Never paste secrets into chat or commit them.

## Compare, score and combine

- **Answers:** side-by-side on desktop, stacked on a phone. Each has independent
  status, optional warnings, elapsed time and available output-token count.
- **Blind review:** hides provider/model labels and brand colors. Answer order
  is randomized once per session. Model text may still self-identify; this is a
  personal-review convenience, not an adversarially blinded experiment.
- **Scores:** rate accuracy, usefulness and clarity 1–5. Click a chosen score
  again to clear it. Notes save when you leave their field. Overall is the
  equal-weight average and appears only after all three criteria are rated.
  These are your judgments, not automated fact checks.
- **Scorecard:** compares all ratings. Sort by overall score or elapsed time.
  Demo timing is artificial and is not a benchmark.
- **Combine:** select completed answers and open **Combined answer**.
  **Assemble editable draft** compiles text and notes locally.
  **Synthesize selected answers** makes one API request to your chosen provider,
  including the original prompt/instructions and selected answers, scores and
  notes. Expand **Preview what will be sent** before sending.
  Synthesis asks for source labels such as [A] and unresolved disagreements;
  attribution and correctness are not guaranteed.
- Edit the combined text and explicitly **Save draft**. Save before switching
  sessions, replacing a draft or exporting. **Draft history** keeps every previous
  saved combined answer when editing, assembling, synthesizing or restoring.
  Select a saved revision to preview it, then **Restore this revision** to make
  it current. The replaced draft is retained too. Unsaved typing is not recorded.
- **Export JSON / Export Markdown:** exports saved prompts, answers, notes,
  scores, the final draft and draft history, without credentials.
- **Stop requests:** aborts waiting where possible. Completed answers remain.
  Providers may already have processed/billed a stopped request. Retry is always
  explicit; nothing is replayed automatically.

## Data and credentials

Sessions live in ~/.local/share/prism/workspace.json, or PRISM_DATA_DIR.
The app starts empty and never reads VolModel's workspace or credentials.

Writes use atomic replacement. Read/corruption failures do not silently reset
data. Only one server can own a data directory. The file and lock use Unix mode
0600; new directories use mode 0700. Windows permissions depend on the local
account/filesystem.

Remembered API keys are **unencrypted entries in this local JSON file**.
Session-only keys are not written. Exports exclude connection settings and keys.
For a complete backup, stop the server and copy the data directory privately;
that backup can contain keys. Do not share it or upload it to GitHub.
Disconnect removes a key from the app; it does not revoke it at the provider or
erase environment values from the parent shell.

The server binds to 127.0.0.1, checks Host/Origin, and requires a random per-launch
token for every API request. The browser stores that token in session storage and
removes it from the URL. This is a local, single-user application, not a public
hosted service.

Live content goes to the selected providers under their policies. OpenAI and xAI
Responses requests set store to false; that setting is not a blanket retention
guarantee.

## Verification

```sh
npm ci
npm test
npm run check
```

Dependency installation is now required for the **plugin and combined test suite**;
the standalone server still uses only Node built-ins. The suite covers
all four adapter payloads/parsers, model discovery, concurrent dispatch, partial
failures, duplicate rejection, cancellation, selected-source synthesis, scores,
stale reviews, credential persistence, export exclusions, restart, corrupt-data
preservation, failed disk writes and HTTP trust boundaries, plus native MCP tool
schemas, UI resources, stdio startup, live opt-in, duplicate-request protection,
restart and local preview authentication. See the changelog for release evidence.

Optional browser test requires a separate Playwright/Chromium installation:

```sh
npm run test:browser
```

For a nonstandard installation, set PRISM_PLAYWRIGHT_MODULE,
PRISM_BROWSER_EXECUTABLE and optionally PRISM_BROWSER_ARGS (a JSON array).
The browser test starts disposable synthetic data and forbids provider calls.
The prior standalone release passed at **1600×1050** and **412×1050 touch**: compare four samples, score,
add notes, blind/reveal, select two, compile, edit/save, export, reload and save
session-only credentials. No page errors or horizontal page overflow.
Screenshots were visually inspected.

The new native UI has its own real-MCP iframe workflow:

```sh
npm run test:plugin-browser
```

It uses the same optional browser environment settings; see the
[plugin verification guide](docs/CHATGPT_PLUGIN.md#verification-and-debugging).

## Architecture

| File                                 | Responsibility                                                             |
| ------------------------------------ | -------------------------------------------------------------------------- |
| src/server.mjs                       | HTTP routing, local authentication, request orchestration and cancellation |
| src/providers.mjs                    | Fixed endpoints, request construction, parsing and model discovery         |
| src/core.mjs                         | Run creation, scores, selected-source synthesis and exports                |
| src/store.mjs                        | Atomic persistence, optional key storage and single-server lock            |
| public/app.js                        | Browser state, rendering and interaction orchestration                     |
| public/index.html, public/styles.css | Page structure and responsive presentation                                 |
| test/app.test.mjs                    | Dependency-free unit/integration tests                                     |
| test/browser.mjs                     | Optional browser workflow                                                  |

The standalone runtime has no external package dependencies. The native plugin
adds the pinned official MCP SDK and Zod, with a reproducible lockfile; its modules
live in `plugins/prism`. See [API notes](docs/API_NOTES.md),
[plugin architecture](docs/CHATGPT_PLUGIN.md#architecture-and-remaining-limits)
and [CHANGELOG](CHANGELOG.md).

## Current limits

Text only, one configured model per provider per run. No attachments, web
browsing, token streaming, automatic judge, cross-device sync or public hosting.
Answers appear when each provider completes.

Requests time out after two minutes; output is limited to 256–8192 tokens per
call. Neither is a dollar-spending cap. Some reasoning models may need larger
limits. Workspace limits are 500 sessions / 40 MB; nothing is automatically
deleted.

JSON exports are portable records, not yet importable through the UI. Back up the
data directory for a full restore. Stale concurrent review/draft writes are
rejected; copy unsaved text before reloading. JSON and Markdown exports include
draft history. History counts toward the 40 MB workspace limit and is never
silently trimmed. A failed synthesis leaves the saved draft/history unchanged.

### Upgrade from 0.1.0

Stop the old server, keep a backup of your private data directory, extract this
version separately and launch it with the same data-directory setting. Existing
sessions and connections are retained; their current draft enters history when
next changed. Drafts overwritten before this upgrade cannot be recovered.
No data migration command is required. The standalone server needs no package
installation; the new native plugin does require `npm ci` and keeps a separate
data directory unless you deliberately choose to reuse the existing one.

No physical Samsung or real provider-account end-to-end test was performed.

## Source history in the release ZIP

`SOURCE_HISTORY.bundle` is an optional Git backup bundled with the release, not
a runtime dependency. It preserves the delivered 0.1.0/0.2.0 tags and the isolated
`builder/chatgpt-plugin` and `builder/browser-sign-in` branches. A separate `builder/session-import-wip` checkpoint
is incomplete and unverified; import is **not** part of this delivered runtime.
To inspect the history without changing your runnable folder:

```sh
git clone SOURCE_HISTORY.bundle ../prism-history
git -C ../prism-history switch builder/browser-sign-in
```

## Source repository

The commissioned repository is [AInewbie/Prism](https://github.com/AInewbie/Prism).
It contains the Prism 0.3.1 browser-access preview, the standalone app, the native
ChatGPT plugin preview, tests, dependency lock and version history. This
repository was supplied by the owner and is public. Keep private workspace data,
provider keys and `.env` files outside Git.

To get the source:

```sh
git clone https://github.com/AInewbie/Prism.git
cd Prism
```

Follow the browser-access or native-plugin setup above. Cloning source does not
host the app or connect it to ChatGPT. No compilation is required for the browser
server; the native plugin requires its documented dependency installation.

Develop subsequent versions on isolated branches and preserve delivered versions.
Do not force-push over existing repository work. This project is independent of
VolModel.
