# Changelog

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
