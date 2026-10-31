# ChatGPT notes request compatibility fix

## Evidence and decision

The user supplied the new diagnostic from version 0.5.0: HTTP 400, parameter `tools`, while generating notes through ChatGPT. This establishes a tool-definition rejection before the notes PDF pipeline. Independent audits found the notes schema structurally valid and simpler than working teaching schemas; no specific invalid keyword or reserved namespace was established. The documented Sign in with ChatGPT route supports namespace tools, so flattening them into top-level functions would introduce an unsupported assumption.

Notes are a structured report, not an action the model must execute. For ChatGPT notes only, request a plain JSON document through text generation and omit the `tools` field entirely. Keep local strict schema, byte limits, evidence membership/coverage, safety, scope/cancellation and stale-snapshot checks. Preserve one inference per explicit click, with no retry or automatic provider fallback. Gemini/Groq retain their established native notes tools. Teaching and roadmap tools remain unchanged.

## Implementation plan

- [x] Add a ChatGPT JSON-notes prompt and parse bounded JSON text with canonical notes/evidence validation. Reject prose, malformed output, unknown evidence and extra calls.
- [x] Omit empty ChatGPT tools and recover completed text output when SSE has no text deltas; preserve normal delta handling and metadata.
- [x] Test the real coordinator/ChatGPT adapter against a synthetic server that rejects any notes `tools` field. Cover safety, cancellation, malformed output and unchanged provider tools.
- [x] Exercise ChatGPT notes in an isolated desktop profile if synthetic encrypted credentials can be seeded safely. Never inspect original credentials or make real inference calls.
- [x] Run focused/full checks, build a separate 0.5.1 installer, verify packaged regressions, install normally and confirm installed hashes and Start launch.

## References

- [Sign in with ChatGPT preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Sign in with ChatGPT errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)

## Verification results

- Full offline suite: **756 passed, one optional test skipped**, across 83 files. TypeScript, full ESLint and production build/bundled-main syntax checks pass.
- Packaged application suite: **9/9 passed**, including ChatGPT, Gemini and Groq notes, offline notes, learner safety, provider teaching/material courses, ElevenLabs, PDF preview/export/restart, deletion with PDF open and second-launch activation.
- The ChatGPT native case uses a fresh profile, test-generated RSA keys, synthetic discovery/token/JWKS endpoints and a local browser callback. Actual OIDC verification, protected credential storage, the real ChatGPT provider/coordinator and the real PDF pipeline run. The synthetic response endpoint rejects a notes request containing any `tools` field. The corrected request omits it, makes one generation request, retains requested/served model metadata and successfully creates a coloured PDF.
- Both actual ChatGPT PDF pages were rasterized at 115 DPI and inspected for equations, diagrams, correctly shaped Hindi, complete question/answer flow, margins and footers. The 81,606-byte document contains no synthetic unheard/unpresented markers.
- Text stream tests cover canonical completed output without deltas, empty deltas, no duplicate text, conflicting text rejection, malformed/prose/multiple JSON, UTF-8 bounds, extra calls, invalid/missing evidence, refusals, cancellation and stale scope.
- Initial full runs exposed Windows ENOTEMPTY failures during cancelled-import staging cleanup and voice-test fixture cleanup. Bounded removal retries were added; the final complete suite used four workers to reduce file contention. No voice runtime behavior changed.

## Release

Installer: `release/chatgpt-notes-fix/Canvas Atlas Setup 0.5.1.exe`.

- Installer SHA-256: `4E620018D0DEF37D5217C8222CE30109CFFCA402AA3DBEC42CFBA7A3DE5D04C1`.
- Tested ASAR SHA-256: `10CEAE34ACB5E84D412BC9B6EBA17AA64F0D720A71817B02BBA4D8282A5CAB8F`.
- Installer exited 0; installed version is **0.5.1**. The installed executable and ASAR match the tested artifacts. The existing Start shortcut targets that executable and successfully opened a visible Canvas Atlas window. Existing account settings and lessons were preserved; the old window closed through its normal save handshake.

No original credentials/profile or real inference quota was used. Live account acceptance remains unmeasured until the user tests their connection. The verified fix removes the rejected tool-admission surface; it does not establish which individual namespace/schema detail the remote service rejected.
