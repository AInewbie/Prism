# Prism browser access preview — 0.3.1

13 September 2026. **Implemented and locally tested; not deployed.**

This preview adds a normal password sign-in to the existing Prism web app.
After a server operator sets it up, the user opens the same address, signs in,
and compares answers. No terminal command or compilation is part of that user's
browser workflow. The server still needs to be running somewhere; this ZIP is
not a live website or an installed ChatGPT plugin.

## Try it locally

The person running the server needs Node 22.13 or newer. Extract the `prism`
folder. Edit an existing `.env` in that folder, or create one from `.env.example`
if none exists. Do not overwrite existing credentials. Set a unique private
passphrase (at least 16 characters) for `PRISM_BROWSER_PASSWORD`. Keep
`PRISM_BROWSER_ALLOW_LIVE=0` for the initial demo. Never send that password in chat.

From the folder, run:

```sh
node src/browser-server.mjs
```

Open **http://127.0.0.1:8797** in a browser and sign in. No `npm install` or
compilation is needed for this browser server. Keep the process running. Ctrl+C
stops it. `PRISM_BROWSER_PORT` can change the port. It deliberately binds only to
loopback; another phone/computer cannot use this localhost address remotely.

Try **Try an example → Compare answers**, score an answer, select two sources,
assemble a draft, edit/save, and restore an earlier draft from history. Sign out
using the header button. Sign in again at the same address to reopen saved work.
Demo responses are fixed samples, not real provider responses.

## The user experience after hosting

The operator configures a private HTTPS endpoint once. The user receives that
address, signs in with the workspace password and uses the normal browser GUI.
No rotating `#key=` link, Node installation or local server startup is needed on
the user's phone. Hosting and TLS are **not** set up by this package.

An approved reverse proxy must preserve the external `Host` header and forward
requests to `127.0.0.1:8797` on the same host. Set `PRISM_BROWSER_ORIGIN` to the
exact external HTTPS origin, such as `https://your-private-prism.example`, with
no path. That example is a placeholder, not a deployed URL. HTTP public origins,
unexpected Host/Origin values and missing origins on writes are rejected. The
server does not trust `X-Forwarded-Host` or `X-Forwarded-Proto`.

Before real deployment, review the hosting location, access, budget, persistent
storage, TLS/proxy configuration and operational monitoring with the owner.
No production deployment, paid hosting purchase or public exposure has been
performed or authorized by this preview. A source package is not a hosted URL.

## Provider accounts and saved data

Browser access defaults to its own `~/.local/share/prism-browser` directory.
`PRISM_BROWSER_DATA_DIR` can select another absolute path. It does not
automatically read existing standalone, plugin, VolModel or portfolio data.
To reuse an existing Prism workspace deliberately, stop its server, make a
private backup, then point this server to it. Only one process may own a folder.

Live provider access is disabled by default. The operator can set
`PRISM_BROWSER_ALLOW_LIVE=1` and restart, then configure provider keys/models
through **Connections** or the documented environment variables. This setting
permits model discovery and live generation/synthesis. It is not a dollar budget;
use provider-side spending controls. No real API calls were made in verification.

Keys entered through Connections are sent to the server; they are not stored in
browser local/session storage or returned in API responses. Optional remembered
keys remain unencrypted in the private workspace JSON, as in earlier Prism
versions. `.env` is also a local secret file. Protect the server account and its
backups. The browser session cookie is HttpOnly. Use HTTPS for any remote access.

## Session behavior and limits

- Sessions expire after 12 hours. Restarting the server, including to change the
  password, ends every login. The URL stays the same; saved comparisons survive.
- Sign out revokes the current cookie immediately. Other signed-in devices are
  separate sessions; a restart revokes all. At most 50 sessions are retained.
- Five password checks per minute are allowed across the whole single-owner
  instance. Excess attempts temporarily block sign-in, including valid passwords.
  This is a simple preview throttle, not an enterprise anti-abuse service.
- Sign out is blocked while edits or requests remain pending. Save first. If a
  session expires while editing, copy unsaved text privately before reloading.
  Automatic reconnect/replay is not added. Provider requests already accepted
  before logout or expiry may finish and may be billed.
- This is one owner's workspace and password, not separate user accounts. Do not
  share it as a multi-user service. No MFA, SSO, account recovery, production TLS
  termination or security audit is supplied. The actual HTTPS deployment and
  physical Samsung remain unverified.
- The previously delivered standalone and native-plugin entry points remain
  available. The new cookie login does not install the native plugin or expose
  its MCP server. Session import remains unfinished on its separate WIP branch.

## Verification

```sh
npm ci
npm test
npm run check
```

The test suite needs the pinned native-plugin dependencies. Browser server
runtime itself uses only Node built-ins. Browser-access tests cover signed-out
data denial, sign-in, cookie flags, logout revocation, origin/Host checks, forged
tokens, duplicate cookies, expiry, bounded attempts, restart reauthentication,
live-disabled gates and enabled generation/synthesis through a fake provider.
The HTTPS-cookie test simulates proxy headers; it is not a real TLS test.
The release passed 27 automated tests and syntax checks. Browser sign-in and
the existing comparison workflow passed at 1600×1050 and 412×1050 touch, including
sign-out/re-entry, saved drafts, history restoration, exports and credential
exclusion from browser storage. Screenshots were visually inspected. The supplied
single-process Chromium build required separate browser launches for independent
cookie jars; this is test-harness isolation, not an app workaround.

The existing browser regression can exercise the new entry point too:

```sh
PRISM_TEST_BROWSER_GATEWAY=1 npm run test:browser
```

It requires a separate Playwright/Chromium installation. The existing
`PRISM_PLAYWRIGHT_MODULE`, `PRISM_BROWSER_EXECUTABLE`, `PRISM_BROWSER_ARGS` and
`PRISM_BROWSER_OUTPUT` options are supported. All data and keys are synthetic.

Implementation: `src/browser-session.mjs` owns password verification and sessions;
`src/browser-server.mjs` validates requests and forwards them to the unchanged
private standalone API; `public/browser-login.*` owns the sign-in page. The
existing comparison interface receives a cookie-session flag and exposes Sign
out while retaining its previous scoring, history and export features.

Sources checked 13 September 2026: [MDN cookie attributes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
for HttpOnly, SameSite, Secure and host-only cookie behavior, and
[Node crypto](https://nodejs.org/api/crypto.html) for scrypt, random bytes and
timing-safe comparison. These guide the implementation, not a security certification.


### Session search and the offline demo (0.3.2)

The browser app filters existing session summaries locally by saved title and
Demo/Live mode; typing in search makes no extra API requests. The current prompt
or comparison is retained. Search currently covers the saved title, not response
bodies. The offline demo searches its saved prompts and shares the same helper.

Reference: [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html),
read 14 September 2026, supports larger touch controls; the new phone search
controls are at least 44px high. This is a targeted improvement, not a complete
accessibility audit. [MDN localStorage documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
(last modified 28 July 2026, read 14 September 2026) describes local-file storage
as browser-dependent. In this environment, the incognito file test lost local
state across reload; the disposable regular browser profile retained it at both
screen sizes. Export any demo result you want to keep. Full server-app storage
is independent of this local-file browser behavior.
