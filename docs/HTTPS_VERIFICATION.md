# Local HTTPS verification — Prism 0.3.1

13 September 2026. This is a reproducible deployment-readiness check, **not a
hosted app, production proxy, trusted public certificate or ChatGPT connection**.
Application behavior and version are unchanged.

Verified on Node 24.19.0 and OpenSSL 3.0.13: 28/28 automated tests, syntax checks,
and the full HTTPS browser workflow at desktop and phone-sized touch viewports.
No production application defect was found; this checkpoint closes a test gap.

## Run the checks

Testing requires Node 22.13+, the OpenSSL command-line executable on PATH, and
the locked test dependencies (`npm ci`). Normal browser-server operation still
requires no OpenSSL CLI, dependency installation or compilation.

```sh
npm test
npm run check
```

For the full graphical workflow, also provide a Playwright/Chromium installation,
as described in the README, then run:

```sh
npm run test:browser:https
```

The existing `PRISM_PLAYWRIGHT_MODULE`, `PRISM_BROWSER_EXECUTABLE`,
`PRISM_BROWSER_ARGS` and `PRISM_BROWSER_OUTPUT` settings are supported. The
alternative `PRISM_TEST_BROWSER_HTTPS=1 npm run test:browser` also works in shells
that support inline environment variables. The existing HTTP/token and HTTP
cookie test modes remain available.

## What this checks

The fixture generates a fresh one-day certificate/key in a private temporary
directory. A Node HTTPS proxy listens on a random **loopback-only** port and
forwards to the real Prism browser server, preserving Host and Origin. That
browser server forwards to the existing private API. All workspace data and
credentials are synthetic; provider calls are blocked.

- Node rejects the untrusted certificate first, then verifies this specific
  certificate and its IP identity with TLS verification enabled.
- The encrypted connection negotiates TLS 1.2 or newer. Login issues a Secure,
  HttpOnly, SameSite=Strict, host-only cookie; signed-out data requests fail.
- Foreign origins and untrusted HTTP hosts remain blocked through the proxy.
- Demo generation/export succeed; logout revokes access without provider calls.
- Chromium uses a process-local exception for **only the generated certificate's
  public-key fingerprint**. No system trust store is changed, no global
  certificate-error bypass is used, and Node verification stays enabled.
- Desktop (1600×1050) and phone-sized touch (412×1050) workflows cover sign-in,
  compare four samples, scoring/notes, blind review, select/combine, edit/save,
  draft restoration, JSON export, reload and sign-out/sign-in. Secure cookie
  attributes and exclusion of keys/tokens from browser storage are checked.

Servers close before temporary workspace/certificate cleanup. Generated keys
are not saved in Git or the release. The supplied single-process Chromium build
is relaunched between viewport runs to isolate cookie jars.

## What remains unverified

This check does not cover public DNS, a real hosting provider/reverse proxy,
public certificate issuance/renewal, uptime, backups, physical Samsung behavior,
actual ChatGPT rendering or real model-provider requests. It does not authorize
deployment, paid hosting or API spending. Do not use this test proxy or its
certificate trust exception for real remote access.

The main branch remains the delivered runnable version. Follow
[browser setup](BROWSER_ACCESS.md) for a local trial; an approved private host is
still needed to give the user an always-available browser link.

Implementation references read 13 September 2026:
[Node HTTPS](https://nodejs.org/api/https.html) and
[Node X509Certificate](https://nodejs.org/api/crypto.html#class-x509certificate).
