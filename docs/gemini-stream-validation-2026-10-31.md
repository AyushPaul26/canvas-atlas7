# Canvas Atlas 0.3.2 — Gemini stream and roadmap recovery

## Reported behavior and root causes

The user supplied two screenshots: one roadmap failed with the fixed service-unavailable diagnostic, another failed with `Gemini returned malformed stream JSON.` Both showed an empty lesson and a teacher still preparing after failure.

Google's [official streaming guide](https://ai.google.dev/gemini-api/docs/streaming) includes `event: done` with `data: [DONE]` after `interaction.completed`. The [official JavaScript SDK](https://github.com/googleapis/js-genai/blob/main/src/interactions/core/streaming.ts) recognizes that control marker before JSON decoding. The previous adapter attempted JSON.parse on every nonempty data frame, including this marker. A native regression using the old packaged0.3.1 reproduced the exact malformed-JSON message on an otherwise successful roadmap response.

The renderer sets phase to thinking before awaiting roadmap planning. Its generic error handler cleared the busy operation and showed a notice but did not reset the phase. A failed unplanned lesson also had no direct roadmap retry action. This explains the stale preparation indicators and repeated new lessons visible in the screenshots.

The service-unavailable message is a separate upstream failure. This update does not claim to restore Google's service capacity. Provider failures must end preparation, preserve the lesson and wait for an explicit user retry; no new automatic service/quota retry or provider fallback is introduced.

## Scope

- Recognize documented Gemini completion framing while still requiring a successful interaction.completed and complete validated steps. A DONE marker alone is not a valid teaching response.
- Preserve native signatures, paired tool history, canonical validators, aborts and byte/time bounds.
- Prefer returned current stable Gemini text models for first-use selection. Keep remembered exact model selections explicit. Google [limits legacy2.5 access](https://ai.google.dev/gemini-api/docs/deprecations/) to prior active users; catalog listing alone does not establish inference eligibility.
- Settle roadmap failures, clean the known Electron invoke wrapper in displayed errors, and offer an explicit same-session Retry roadmap without losing topic or canvas.

## Verification record

- Old packaged0.3.1 regression: failed as expected in8.8seconds. Retained synthetic error context contains both the exact malformed-JSON message and `Your teacher is preparing…`.
- Updated native Gemini fixture returns a legacy model first and a current3.5Flash-Lite model last, injects oneHTTP503 on the first roadmap request, then supplies named SSE frames withCRLF in seven-byte chunks and the documented DONE marker. It requires no automatic503 retry, an idle failure state, explicit same-session retry and the full existing teaching/material/restart journey.
- Gemini focused TDD: **48 passed**, including11new regressions; scoped ESLint passed. The documented DONE case and unterminated EOF case were observed failing before their fixes.
- Renderer focused: **43 passed**, including failure/retry and stale planning success/failure regressions; scoped ESLint and TypeScript passed.
- Complete automated suite: **506 passed, one optional skipped;65files passed, one skipped**. TypeScript, ESLint, production build and patch formatting checks passed.
- Initial full run passed505tests but failed one existing test's temporary-directory removal with Windows ENOTEMPTY. The directory was empty when inspected, the isolated test passed2/2, and the complete rerun passed506/506. No test/application code was changed to suppress that cleanup failure.
- Independent read-only review found no concrete P1/P2 issue in Gemini terminal/signature/bounds handling, model ranking, roadmap retry, saved scene/topic preservation or stale-result rejection.
- Final packaged desktop suite: **four passed** (1.7minutes while the installer compressed): Gemini503→explicit retry→fragmentedDONE success, Groq streamed generation repair, ElevenLabs settings/audio, and startup/relaunch activation. The Gemini journey continues through validated teaching, a real sandbox slider, a question, TXT-based course citations and restart. The synthetic screenshot was visually inspected; it is not evidence of live model teaching quality.

No live inference requests are used for this update's verification. Synthetic desktop profiles and dummy keys cover the failure paths. No real credentials, existing lessons, request headers or private provider payloads are copied into the test artifacts. Final user acceptance with Gemini remains separate from fixture success.

## Artifacts

- Installer: `release/gemini-stream-fix/Canvas Atlas Setup 0.3.2.exe`, **148,192,096 bytes**.
- Installer SHA256: `2F338B427F40DD5006936D04B03B8C12A58D6F03001FCFE6F614E78A943DA19B`.
- Tested packaged app.asar: **121,481,279 bytes**, SHA256 `D7D3555A67EB166C3879A0F7E6E763B2EC9E47ED3465B2182AF9330320300FEC`.
- Build, regression and checksum evidence retained under ignored `.test-tmp/gemini-groq/`. Older0.3.0/0.3.1 artifacts and validation reports remain available.

Silent installer exit0; installed product version0.3.2.0. Installed app.asar matches the tested package hash. Reopened through the real Start shortcut and verified a visible main window (PID29960).

Installed executable: `C:\Users\Ayush Paul\AppData\Local\Programs\Canvas Atlas\Canvas Atlas.exe`. No post-install AI-generation probe was run. Normal account/model metadata refresh on app opening remains part of the existing application behavior.
