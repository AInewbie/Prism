# Prism inside ChatGPT — 0.3.0 plugin preview

**13 September 2026. Locally verified; not yet connected to your ChatGPT account.**
This package adds a native MCP interface to Prism 0.2.0. It is not a screenshot,
Sites deployment, public plugin listing, or a ZIP that ChatGPT runs on upload.
The included local host exercises the actual MCP server and embedded interface.

## What you can do

Send one prompt to selected OpenAI, Gemini, Grok and Claude models, compare their
answers, hide identifying labels, save your own scores and notes, select sources,
compile an editable answer, or request synthesis from one provider. Saved draft
history supports preview and restoration. Existing standalone source is intact.

Demo uses clearly labelled fixed samples, not actual model output. Live mode
requires your separate provider API accounts; a ChatGPT subscription does not
provide those credentials or credits. No live calls were made for this release.

## 1. Try the embedded interface locally

Install Node **22.13 or newer**. Extract the ZIP and open its `prism` folder:

```sh
cd prism
npm ci
npm run preview:plugin
```

Open the complete localhost URL printed in the terminal. This is explicitly a
**local MCP host preview, not ChatGPT**. It always uses demo mode and ignores
provider keys from your environment. Try Compare answers, save a review, assemble
a draft, edit/save it, assemble again, then restore it from Draft history.

Keep the terminal running; Ctrl+C stops it. Port 8796 must be available.
Saved preview data lives in `~/.local/share/prism-plugin-preview`.
There is no compilation step. `npm ci` installs the pinned MCP dependencies.

## 2. Connect privately to ChatGPT

The documented route is **Secure MCP Tunnel**: Prism runs on your computer or a
private server, and the tunnel relays MCP requests without a public Prism port.
The machine and tunnel process must stay running. This release supplies a stdio
MCP server; **do not expose the preview server or internal HTTP API publicly**.
[OpenAI connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt)

Account setup is not performed by this package. You need ChatGPT developer-mode
access and a Platform tunnel with the correct workspace association. Availability
and organization permissions have not been verified for your account.

1. Enable ChatGPT developer mode in **Settings → Security and login**. Managed
   workspaces may require an administrator to grant access first.
2. Open [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels).
   Create a tunnel associated with the target ChatGPT workspace and your Platform
   organization. Creating requires **Tunnels Read + Manage**; running/selecting
   requires **Read + Use**. Developer-mode permission is separate.
3. Install `tunnel-client` using the download link there or the
   [official latest release](https://github.com/openai/tunnel-client/releases/latest).
   Configure its runtime key as `CONTROL_PLANE_API_KEY` in its local environment
   using your local secret manager. Do not paste it into ChatGPT, a screenshot,
   this repository, or command history.
4. Initialize a private stdio profile. Replace `YOUR_TUNNEL_ID` and the absolute
   Prism path below; ensure `node` is available to the tunnel process. A path
   without spaces is simplest. Run the documented diagnostics, then the client:

```sh
tunnel-client init --sample sample_mcp_stdio_local --profile prism --tunnel-id YOUR_TUNNEL_ID --mcp-command "node /absolute/path/prism/plugins/prism/server.mjs"
tunnel-client doctor --profile prism --explain
tunnel-client run --profile prism
```

5. Open [ChatGPT Plugins](https://chatgpt.com/plugins), use the plus button to
   create a developer-mode connection named **Prism**, and choose **Tunnel**.
   Select your tunnel or enter its identifier. Keep `tunnel-client` running.
6. Start a new conversation, enable Prism, and ask: **“Open Prism in demo mode.”**
   Complete the same compare → score → combine → restore workflow in ChatGPT.

These are implementation-specific instructions adapted from the official
[Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels),
checked 13 September 2026. The tunnel client, account registration, host tool
approvals and actual ChatGPT rendering remain **unverified here**. If Tunnel is
missing, check permissions and workspace association; do not bypass access controls.

### Before switching to real models

Stop the tunnel. Copy `.env.example` to `.env` in the extracted Prism root and
edit it locally. Add your provider keys and available model IDs. Set
`PRISM_PLUGIN_ALLOW_LIVE=1` only when ready to authorize provider spending.
Restart the tunnel; the server automatically loads this file. Existing process
environment values take precedence. To change keys later, restart again.

The GUI can edit model IDs but cannot read or enter keys. An environment model ID
is reapplied at startup; remove that override if you prefer your saved GUI choice.
Each live comparison and synthesis requires an explicit confirmation flag; the
GUI presents a corresponding notice. Keep ordinary ChatGPT tool approvals enabled.
These safeguards are not a hard dollar budget. Limit spending at each provider.

Live comparisons send the prompt and shared instructions to selected providers.
Synthesis additionally sends selected answers, scores, notes and your direction
to the chosen synthesis provider; preview that payload before confirming.
ChatGPT receives the MCP data needed for its interface even though the server
endpoint is private. This is not a guarantee that content stays on your machine.

## Saved sessions and existing standalone data

The plugin defaults to `~/.local/share/prism-chatgpt`, independent of the demo
preview and the standalone app's `~/.local/share/prism` directory. It does not
automatically copy, migrate or expose existing personal sessions or connections.

To deliberately reuse standalone sessions, stop **all** Prism processes, make a
private backup, then set `PRISM_PLUGIN_DATA_DIR` to that existing absolute data
directory. Only one process may own it. The standalone GUI can also be launched
against the plugin data directory using `PRISM_DATA_DIR` after stopping the tunnel.
Do this if the ChatGPT host blocks the widget's JSON download or you want the
standalone Markdown export and model discovery. Never run both against one folder.

Environment keys stay in memory; `.env` itself is an unencrypted local secret
file. Old remembered standalone keys, if you explicitly reuse that workspace,
remain unencrypted in its JSON file. Protect backups and operating-system access.
MCP tools expose no credential-setting endpoint, keys, internal token or server
path. Prompts, responses and reviews are content, not trusted instructions.

Save reviews explicitly in this interface. Unsaved edits block session changes,
combination, restoration and export. Refresh retains unsaved text but stale saves
are rejected: copy it privately, reload the latest session and reapply deliberately.
Closing the chat can discard unsaved typing; a host may suppress unload warnings.
Blind mode only hides labels and models may identify themselves in their answers.

## Verification and debugging

```sh
npm ci
npm test
npm run check
```

The automated suite covers the standalone app and native MCP schemas, UI resource,
manual reviews, draft history, live opt-in, no key leakage, simulated concurrent
dispatch, persistent request IDs and the actual stdio entry point using the
official MCP client. All provider responses in tests are fixtures.
This preview passed **21 automated tests** and syntax checks. Browser verification
covered **1160×1100** and **412×1100 touch**, including saved-session reopening,
JSON export, draft restoration and treating answer text as text instead of HTML.

Optional browser check, with a separately installed Playwright and Chromium:

```sh
npm run test:plugin-browser
```

For nonstandard installations set `PRISM_PLAYWRIGHT_MODULE`,
`PRISM_BROWSER_EXECUTABLE`, and optionally `PRISM_BROWSER_ARGS` (JSON array).
The browser test uses disposable data, forbids external requests, and exercises
the real MCP server through the local host at desktop and phone widths.

`node plugins/prism/server.mjs` is the raw stdio entry point. It waits silently
for an MCP client; it does not print a website address. Use the preview command
for a browser. If startup fails, check Node/dependencies, model IDs, local file
permissions and another process owning the data directory. Do not delete or
reset a workspace to conceal a startup failure.

After changing MCP metadata or the UI resource, restart the tunnel, refresh the
connection in ChatGPT Plugins, then use a new conversation. Never replay a paid
comparison to recover a transport error: reopen its saved session first. The
same `request_id` and inputs return the same comparison, including after restart.

### Architecture and remaining limits

- `plugins/prism/backend.mjs`: reuses the standalone API privately; concurrent jobs,
  consent gates, persistent request IDs and environment-only key configuration.
- `plugins/prism/mcp.mjs`: ten narrowly scoped tools and the inline MCP Apps UI.
- `plugins/prism/widget.*`: embedded GUI, host bridge and responsive presentation.
- `plugins/prism/server.mjs`: stdio entry point for the private tunnel.
- `plugins/prism/preview.mjs`: demo-only local test host, not a deployment server.
- Root manifest and `.mcp.json`: local plugin bundle descriptor. Developer-mode
  tunnel registration uses the explicit command above, not an upload/install link.
  Bundle-loader `${PLUGIN_ROOT}` expansion has not been tested in a ChatGPT install.

This is a single-owner preview. There is no public HTTP MCP endpoint, OAuth,
multi-user isolation, public directory submission or unattended production service.
Hosting and wider access need a separate decision and security review. No account
connection, paid API call, physical Samsung run or public deployment is claimed. Text-only answers arrive on completion, not token-by-token. No uploads,
automatic judge or import UI is added. Large histories count toward the existing
40 MB workspace limit. Stop is best effort; upstream usage may already be billed.

Additional official implementation references, accessed 13 September 2026:
[MCP server](https://developers.openai.com/plugins/build/mcp-server),
[embedded UI](https://developers.openai.com/plugins/build/chatgpt-ui),
[app quickstart](https://developers.openai.com/plugins/build/app-quickstart).
