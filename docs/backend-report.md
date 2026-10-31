# Desktop backend implementation report

Implemented the Electron foundation, configuration and lockfile, protected app-specific ChatGPT sign-in, account model discovery, Responses streaming, local SQLite lessons, typed preload/IPC, request interruption, and actual presentation checkpoints. Renderer, voice implementation, protocol/core teacher, and simulation containment are owned by the other workers.

## Authentication and provider

- New authorization starts only when the user chooses Continue with ChatGPT. It uses the system browser, an already-listening `127.0.0.1` loopback callback, a persistent app-specific `urn:uuid` host ID, fresh PKCE S256/state/nonce, and initial `dynamic_agent_client` registration. The issued client ID is used in code exchange and later sign-ins. No other application's credential cache is read.
- OpenID discovery is constrained to the official issuer. `jose` validates signature, issuer, issued-client audience, expiration, subject and nonce before replacing credentials. Returning sign-in must preserve the registered identity. Cancellation and invalid callbacks leave an existing account untouched; late timed-out callbacks cannot save credentials.
- Electron `safeStorage` encrypts access/refresh/ID tokens before an atomic file replacement. Unprotected storage is rejected. Tokens are never exposed by the bridge, saved in lesson data, exported, or deliberately logged. Host/client/subject mappings are separate non-secret registration metadata. Single-instance desktop locking prevents competing refresh processes.
- Refreshes serialize within the application, save rotating replacements and reject renewal after sign-out. Sign-out attempts the discovered revocation endpoint, clears local credentials, retains the registration mapping and reports when remote revocation was not confirmed.
- The selected account's visible model catalog is fetched from public `/v1/models`; no model or quota is assumed. Inference uses public `/v1/responses`, OAuth bearer authorization, `store:false`, `stream:true`, full required history and namespaced strict `teaching.present_beat` calls. There is no API-key billing fallback.
- Stream parsing handles arbitrary transport chunks, SSE records and terminal failures. Partial argument fragments are never executed. Complete calls are deduplicated and JSON checked; successful acceptance waits for `response.completed`. Interrupted, incomplete, quota, authorization and service failures preserve the committed lesson. Planning is bounded to eight rounds and two repair attempts.

Official documentation fetched before implementation:

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [OpenID verification](https://developers.openai.com/siwc/website)
- [Accounts, renewal and revocation](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Plan-route requirements and limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Namespaced function tool contract](https://developers.openai.com/api/docs/guides/function-calling)

## Local state and presentation

SQLite uses parameterized statements, foreign keys, WAL, FULL synchronization and transactional initialization. Tables cover sessions, sequenced events, scene snapshots, program versions, checkpoints, learner evidence and preferences. Unknown future schema versions are rejected without deleting data. Event appends check the expected sequence; nested repository work participates in the same transaction.

`createSession` only creates local data. `sendMessage` starts the authorized teacher. Each turn receives an app-owned epoch and AbortSignal; replacement/interruption suppresses stale output. Manual scene saves advance a separate semantic revision, so pending output cannot overwrite learner edits. Unchanged saves are ignored. Ordinary persistence does not stop teaching or destroy idle experiments.

Prepared beats are stored only in audit events and delivered for presentation. They do not appear in restored lesson scenes, transcripts, or presented beats. `presentProgress` validates the current epoch and known accepted beat, requires an extending narration prefix, and transactionally stores only actual revealed geometry and narration. It does not advance semantic edit revisions. Interruption preserves the last progress checkpoint. Tool feedback explicitly distinguishes prepared content from presented content; passive listening is not recorded as mastery.

Optional simulation checkpoints persist artifact, exposed state, tick, control values, original values and ordered input history as data. Loading the database does not evaluate source. The separate sandbox service reconstructs VM state by deterministic replay; exposed state alone is not treated as a complete snapshot. Replay IPC limits are 36,000 ticks and 1,000 ordered input changes. Main delegates every generated program to the isolated simulation service and requests actual preflight before accepting an experiment.

## Desktop boundary

The main window uses context isolation, Chromium sandboxing, disabled Node integration (including workers), disabled webviews and denied new windows/navigation. Its renderer session blocks remote network requests in production and receives a restrictive CSP. Only local audio media permission is eligible. The preload exposes named bridge methods rather than general IPC, file, shell or execution capabilities. IPC rejects other windows/subframes and validates/bounds commands, scenes, replay requests and audio sizes.

IPC handlers are registered before loading the renderer, avoiding startup races. Fonts, CSS, worker scripts and WASM are bundled locally. The foundation includes Electron/Vite/TypeScript, npm workspace aliases, Vitest, ESLint, Playwright, electron-builder scripts, and a complete exact-version lockfile. Graphify remains optional development tooling.

## Verification recorded

Tests were written and observed failing before their implementations. The backend verification command passed **18 tests in 8 files**:

```text
npm test -- tests/integration/chatgpt-auth.test.ts tests/integration/chatgpt-provider.test.ts tests/integration/session-storage.test.ts tests/integration/desktop-coordinator.test.ts tests/unit/tool-stream.test.ts tests/unit/credential-store.test.ts tests/unit/request-epochs.test.ts tests/unit/ipc-boundary.test.ts
```

Coverage includes PKCE/issued-client exchange; altered state/host/path, nonce and JWT signature rejection; active-account cancellation; serialized refresh; protected credentials; SQLite reopen/conflict/rollback/schema handling; checkpoint provenance; supported request fields; duplicate/fragmented calls; terminal quota/incomplete/aborted streams; stale epochs and semantic edits; prepared versus actual presentation; trusted bounded IPC.

`npm run build` passed with local renderer, preload, simulation worker and WASM output. `npm run test:e2e -- tests/e2e/desktop-shell.spec.ts --output test-results-shell` passed **1/1** on actual Windows Electron: local UI, no renderer `require`/`process`, denied navigation with retained document, and saved lessons after offline restart. Electron's canceled-navigation behavior leaves a pending Playwright navigation target; the test verifies the real document location and visible DOM for that assertion rather than Playwright's cached page URL.

The loopback OAuth tests and OS credential-file fixture checks require an unrestricted local test process in this environment: the command sandbox blocks loopback fetch and some temp-file renames. The final passing backend run used the approved elevated test command. No live sign-in or paid request was initiated by the test suite.

`npm audit --omit=dev --json` reported **0 vulnerabilities**. The full development tree reports **8 moderate** advisories through electron-builder's legacy download/proxy/log-format chain (`sprintf-js` precision denial of service). These are development packaging dependencies; no production dependency advisory was reported. npm suggests an older electron-builder release, not a patched current dependency. The current pinned packaging tool is retained for the parent's integration decision.

## Remaining limits

Real account authorization, eligibility, model availability and a successful fresh-topic provider request must be verified by the user completing Continue with ChatGPT in the running app. The mocked identity/provider tests do not prove current account entitlement or service availability. No fake teaching content is used to conceal this gate.

The bridge currently manages one selected registration; it retains that registration across sign-out. A separate multi-account picker is not part of this integration contract. Database schema v1 is initialized transactionally; future migrations need their own backup and migration implementation. Broad pedagogical validity, quantitative verification and complete spoken-word alignment are separate concerns from the backend checks above.
