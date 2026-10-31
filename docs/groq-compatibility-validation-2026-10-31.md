# Canvas Atlas 0.3.1 — Groq compatibility follow-up

## Reported failure and findings

In 0.3.0, the catalog's first returned model became the first-use selection. The user's app selected `allam-2-7b` and rejected roadmap planning. Selecting `openai/gpt-oss-20b` then produced `Groq could not complete the response stream.` The first message establishes an HTTP request rejection, while the second identifies the parser's generic SSE error branch. Neither message retained the original remote error code, so its exact cause cannot be reconstructed.

Two concrete application defects were verified:

- Catalog order could choose Allam despite its documented 4,096-token context and more suitable tool models in the same catalog. The adapter now excludes Allam and orders returned documented tool models before unknown text models, preferring GPT-OSS20b. Unknown exact model IDs remain manual options. Remembered choices are not silently replaced.
- HTTP tool-generation errors entered the coordinator's bounded repair, while the same error inside HTTP-success SSE was collapsed into a fatal generic message. Both transports now share a fixed diagnostic classifier. Only explicit `tool_use_failed` receives bounded repair; partial calls are discarded, and no call IDs or tool outputs are fabricated. Quota, key, context, model, service and request errors remain nonrepairable with distinct messages. Unknown remote text and rejected generated content are not forwarded.

References: [Allam model limits](https://console.groq.com/docs/model/allam-2-7b), [Groq tool-use models](https://console.groq.com/docs/tool-use/overview), [official SDK streaming error handling](https://github.com/groq/groq-typescript/blob/main/src/core/streaming.ts).

## Verification

- Focused adapter/parser TDD: nine catalog/HTTP regressions failed before the first fix; fifteen SSE regressions failed before the second fix. Final **52 passed**, scoped ESLint passed.
- Native regression against the old 0.3.0 package failed as expected: Allam was automatically selected instead of GPT-OSS20b.
- Updated native workflow fixture returns Allam first, an unknown model second and GPT-OSS20b last, then returns a streamed `tool_use_failed` on its first roadmap attempt. It requires the proper default, successful repair on the second attempt and the existing complete teaching/material/restart journey.
- Complete automated suite: **491 passed, one optional skipped**. TypeScript, ESLint and production build passed.
- Final packaged desktop suite: **four passed** in 46.5 seconds. Groq's first streamed tool failure repaired successfully on the second attempt; Gemini, ElevenLabs playback/settings and startup/relaunch regressions also passed.
- Independent read-only review found no concrete P1/P2 issue in catalog selection, error classification, partial-call discard, typed error propagation or bounded repairs.

## Live diagnostic

A short roadmap probe through the normal installed 0.3.0 app's saved Groq connection succeeded with `openai/gpt-oss-20b`: HTTP200, six concepts. The probe used the app bridge and its normal credential handling, inspected no credential files, exported no request headers/bodies or existing lessons, and removed only its newly created diagnostic lesson. Captured output contains only public model/status and fixed error classifications.

Post-install 0.3.1 live roadmap testing observed an HTTP200 stream containing `tool_use_failed`, followed by a successful repair request and a seven-concept roadmap. This directly verifies recovery from a real streamed generation rejection. The original user error's exact remote code was not retained, so its identity still cannot be proven retrospectively.

A subsequent bounded probe created a six-concept roadmap and waited for actual teaching completion events. The initial teaching response contained `tool_use_failed`; its repair request received HTTP429 `rate_limit_exceeded`. No teaching beat was prepared and no additional API retries were attempted after that limit. The initial probe's startConcept acknowledgement alone did not establish teaching preparation; the second probe correctly waited for done/error events. No real audio/visual lesson presentation is claimed from these probes.

These checks establish real roadmap generation and streamed-error recovery with the saved connection and selected model. They do not establish complete live lesson quality or acceptance by every catalog model. The opt-in isolated evaluator retains its original profile requirement; these one-off installed-app diagnostics are separate. Logs contain only public model/version/status, fixed error codes and aggregate counts; temporary probe lessons were removed.

## Package and installation

- Installer: `release/groq-compat/Canvas Atlas Setup 0.3.1.exe`, **148,195,422 bytes**.
- Installer SHA256: `105A321193B09324407BBD20C01DA703F6B0C4FFF2F5ECA7C2B1F25CE8DE8827`.
- Packaged/installed app.asar: **121,477,946 bytes**, SHA256 `C91080A94A5ACDD06A7035E241F5C4DC9DB75F489F533EA1265B5C531AA92886`.
- Silent installer exit0; installed executable reports0.3.1.0 and installed asar matches the tested package.
- Installed executable: `C:\Users\Ayush Paul\AppData\Local\Programs\Canvas Atlas\Canvas Atlas.exe`.
- Reopened through the real Start shortcut; visible main window verified (PID23024), installed product version0.3.1.0.

Prior 0.3.0 evidence remains in [the original validation report](multi-provider-validation-2026-10-31.md); ignored build/test/probe logs remain under `.test-tmp/gemini-groq/`.
