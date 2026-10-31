# Canvas Atlas Gemini and Groq Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Status:** APPROVED by the user on 31 October 2026; implementation, fixture verification, packaging, and installation complete. Real-key acceptance remains pending. See `docs/multi-provider-validation-2026-10-31.md` and `.test-tmp/gemini-groq/progress.md` for evidence and practical limits.

**Provider correction:** Groq at console.groq.com replaces the earlier xAI/Grok proposal. Gemini and the existing ChatGPT connection remain in scope. This supersedes the gemini-grok plan.

**Latest user requirements:** remove only the persistent "ChatGPT connected" writing from the main header/sidebar, preserving the existing ChatGPT backend and all remaining interface/features. Successful Gemini/Groq Connect/Replace automatically activates that provider; no second provider-switch action is required. This updates the earlier header-status/manual-activation proposal. The user subsequently approved implementation.

**Goal:** Run all existing teaching intelligence through a selected ChatGPT, Gemini, or Groq connection, including roadmap/course generation, live visual explanations, simulations, and follow-up conversation.

**Architecture:** Retain the Electron main-process backend and add a provider manager plus native adapters behind typed, provider-neutral tool contracts. Keep canonical teaching validation, source grounding, presentation timing, local storage, simulation isolation, and speech services in their existing layers.

**Tech Stack:** Existing Electron, React, TypeScript, Zod, SQLite, Chromium-backed fetch, SSE/ReadableStream, Vitest, and Playwright. No new runtime dependency is planned.

**Spec:** `docs/superpowers/specs/2026-10-31-gemini-groq-design.md` (the accompanying design document).

## Global constraints

- Baseline: v0.2.0 source at `C:\Users\Ayush Paul\Desktop\akki hacks\learner guide\living-canvas`. Reconfirm it before edits; other found copies are older. Preserve existing uncommitted work. Do not create or rebuild the absent old source path.
- User approval for implementation/build/installation was received on 31 October 2026. Use real provider keys only after direct user entry for live acceptance; no GitHub push or release publication was requested.
- Provider IDs: `chatgpt`, `gemini`, `groq`. Existing users default to ChatGPT; old selectedModel migrates into ChatGPT only.
- Successful protected key connection automatically activates and persists the corresponding Gemini/Groq provider. Use its remembered available model, or select an initial compatible model only when no remembered selection exists. Keep unavailable remembered IDs explicit and require model recovery rather than silent substitution. Subsequent new generation uses the active provider; no extra provider-switch click.
- Hide only persistent "ChatGPT connected" text in App.tsx header/sidebar. Keep account/settings targets, account name, indicators, requested/served model line, other UI, and existing ChatGPT backend behavior. Do not introduce replacement front-screen provider connection labels. Put connection details in Settings; preserve the separate sign-in toast.
- Gemini uses native Interactions, x-goog-api-key, stream, store:false. Groq uses Chat Completions at https://api.groq.com/openai/v1/chat/completions with Bearer key, messages and streaming local tool calls. Omit unsupported store and messages[].name fields; do not assume Responses payloads, strict flags, or namespaces on the Groq route. All network requests stay in main through createDesktopFetch and fixed destinations.
- Groq streaming local tool calls use canonical local Zod validation and repairs. Groq response_format:json_schema cannot be combined with streaming or tool use; any verified fallback must be a separate non-streaming request without tools.
- Windows OS encryption; no raw keys in public state, SQLite, exports, logs, test fixtures, or source. Use separate gemini-key.enc and groq-key.enc files in the existing profile.
- Preserve canonical tool names, schema/source validation, existing context/repair/queue/stream bounds, playback receipt gates, simulation sandbox, app identity/startup, local recognition, and ElevenLabs/local narration.
- Additive JSON preference/event compatibility is preferred; no SQLite table migration or automatic cross-provider fallback is planned.
- No new OCR, attachments, generated media, provider speech engines, remote tools, or web/X search in this work.

## Review focus

1. Connecting a key automatically selects that provider, but slow/reversed validations must not override a later user connect, provider/model selection, or key removal. Switching during roadmap/course/lesson work rejects stale completion (Tasks 2, 6, 8).
2. Required native tool/thinking continuation must survive repair calls without being forwarded to another provider or incompatible model/credential revision (Tasks 3–6).
3. A valid catalog key can still lack model permission, paid quota, or schema compatibility; the UI must distinguish those failures (Tasks 2–5, 7).
4. Old ChatGPT history/preferences/exports must load without invalidating completed lessons, source citations, or offline playback (Tasks 1, 6, 8).
5. Same model strings across different providers, malformed/partial streams, duplicate calls, and changed canvases must not bypass identity or commit validation (Tasks 1, 3–6, 8).

## Proposed file map

Create:

- `packages/protocol/src/ai.ts`: public provider/configuration/selection/status schemas.
- `apps/desktop/src/main/ai/provider-contract.ts`: internal messages, tools, calls, results, continuation, snapshot, and AIProvider interface.
- `apps/desktop/src/main/ai/provider-manager.ts`: connections, exact model selections, revisions, readiness, dispatch, and invalidation.
- `apps/desktop/src/main/auth/api-key-store.ts`: protected provider-key persistence using the established OSProtection contract.
- `apps/desktop/src/main/ai/schema-adapters.ts`: provider-specific schema serialization and reversible tool naming.
- `apps/desktop/src/main/ai/gemini-provider.ts`, `gemini-stream.ts`, `groq-provider.ts`, `groq-stream.ts`: native integrations; Groq requires its own Chat Completions parser rather than the current Responses parser. Keep parsing and transport bounded.
- `apps/desktop/src/renderer/ai/TeachingSettings.tsx`: teaching connection UI in the existing settings modal.
- Provider contract/key/manager/schema/adapter tests under `tests/unit/` and `tests/integration/`; `tests/e2e/ai-providers.spec.ts` and renderer component tests.

Modify:

- Protocol `core.ts`, `index.ts`; teacher `tool-schema.ts`, `index.ts`, `planner.ts`, `course-planner.ts` for canonical tool definitions.
- Main `app.ts`, `ipc-router.ts`; `ai/chatgpt-provider.ts`, `tool-stream.ts`, all three coordinators; `storage/session-repository.ts` for scoped history/provenance.
- Preload `app-bridge.ts`; renderer `bridge.ts`, `App.tsx`; shared settings CSS only as necessary.
- Existing model selection, IPC boundary, source grounding, continuation, storage, and renderer tests; `scripts/eval-live.mjs`; documentation and version manifests at delivery.

Paths under main/preload/renderer are relative to `apps/desktop/src`.

### Task 1: Provider contracts and legacy compatibility

**Interfaces:** `ProviderId`; `TeachingSelection {providerId,modelId,selectionRevision,credentialRevision}` with a numeric selectionRevision and UUID string credentialRevision for API providers; public `TeachingConfiguration` and `TeachingStatus` with connected/model-ready/error state and no secret. Internal `AIProvider {id; listModels(signal):Promise<ModelInfo[]>; complete(request:TeachingRequest,signal):Promise<TeachingResponse>}`. TeachingRequest has selection, instructions, typed messages/tool results, canonical tools, and optional scoped native continuation. TeachingResponse has normalized complete calls, canonical replay data, optional native continuation, and provider-aware ModelRunMetadata.

- [ ] Write `tests/unit/ai-contracts.test.ts`: accept all three providers, reject unknown IDs and malformed/bounded inputs; same model IDs under two providers remain distinct; public configuration cannot include a key.
- [ ] Run `npx vitest run tests/unit/ai-contracts.test.ts` and confirm the new expectations fail before implementing.
- [ ] Add exact public/internal types, tagged message unions, explicit tool-name mapping, and optional providerId in ModelRunMetadata. Define continuation scope as providerId + modelId + credentialRevision. Keep absent providerId readable as legacy ChatGPT.
- [ ] Add pure version-1 preference migration: old selectedModel becomes only teachingSettings.models.chatgpt; existing installations select chatgpt. Preserve explicit unavailable saved IDs.
- [ ] Rerun the new contract tests plus protocol/storage tests. Record the validated patch as a focused commit only within the approved Git workflow; do not push.

### Task 2: Protected keys, catalogs, and provider manager

**Files:** new api-key-store.ts and provider-manager.ts; main app/IPC wiring is completed in Task 6. Tests: `tests/unit/ai-key-store.test.ts`, `ai-provider-manager.test.ts`.

**Interfaces:** manager exposes `configuration()`, `status()`, `listModels(providerId,signal)`, `connectKey(providerId,key)`, `clearKey(providerId)`, `select({providerId,modelId})`, `snapshot()`, and `complete(request,signal)`. A successful connectKey validates/persists the key and activates/persists that provider in the same user action; its returned public configuration includes the resulting selection/readiness. Key input is permitted only for gemini/groq; no key getter is exposed by IPC.

- [ ] Write failing tests for encrypted persistence, restart with several saved providers, successful Connect/Replace auto-activation, no extra select call, remembered available/unavailable models, first-use model initialization, empty/incompatible catalogs, failed validation/persistence retaining the old credential/provider/model, key removal during validation, late catalog results, and exact per-provider model restore.
- [ ] Run `npx vitest run tests/unit/ai-key-store.test.ts tests/unit/ai-provider-manager.test.ts`; verify targeted failures.
- [ ] Implement atomic protected storage of `{key,credentialRevision}` with a newly generated UUID on successful connect/replace. Restore that UUID with the key across restart; never reuse a process-local revision for a different credential. After validation and protected persistence, automatically activate/persist the corresponding provider. Reuse a remembered available model, choose an initial compatible model only when none is remembered, and retain an unavailable saved model with needs-model status. Empty/incompatible catalogs must not report teaching readiness. Add selection revisions, bounded catalog requests, sanitized provider-specific errors, and dispatch by immutable snapshot. Catalog validation must not claim successful inference or quota.
- [ ] Selection/active-key invalidation, including successful key auto-activation, calls the supplied checkpoint/cancel transition. Removing an inactive key leaves active lessons and voice configuration alone; typing changes nothing. Track both per-provider connect revision and a global user-intent revision so earlier validation cannot override a later connect/select/remove action. Failed validation/persistence must not activate the new provider. Do not change providers automatically after runtime failure.
- [ ] Verify tests pass with identical model IDs across providers, simultaneous connections completing in reverse order, a pending connection followed by manual model/provider selection or removal, and restart retaining the saved active provider. Add invalid saved preference coverage, then review/commit the focused patch.

### Task 3: Canonical tools and ChatGPT regression adapter

**Files:** provider-contract.ts, schema-adapters.ts, chatgpt-provider.ts, tool-stream.ts; teacher tool builders. Tests: new `ai-schema-adapters.test.ts`, existing `chatgpt-provider.test.ts` and `tool-stream.test.ts`.

- [ ] Write failing tests for all four tool schemas and canonical namespace/name ↔ provider wire-name round trips. Exercise nullable optional fields, union branches, tuples, nested simulation/visual actions, and unknown/duplicate tool names.
- [ ] Run `npx vitest run tests/unit/ai-schema-adapters.test.ts tests/integration/chatgpt-provider.test.ts tests/unit/tool-stream.test.ts`.
- [ ] Separate canonical Zod-derived schemas from provider formatting. Wrap the current ChatGPT account route in AIProvider while preserving its exact authorization, model choice, strict namespace tools, output parsing, and account-specific error semantics.
- [ ] Keep existing stream safeguards: maximum 4,000,000 received bytes and 1,000,000 argument characters; accept calls only after successful terminal completion. Keep the existing 180-second inference timeout and 30-second catalog timeout unless a separately documented compatibility finding requires a change.
- [ ] Prove incomplete, blocked, failed, oversized, duplicate-conflicting, and canceled responses yield no accepted teaching calls; run the focused tests plus teacher schema suites before review/commit.

### Task 4: Gemini native adapter

**Files:** gemini-provider.ts, gemini-stream.ts, schema-adapters.ts. Tests: `tests/integration/gemini-provider.test.ts`, `tests/unit/gemini-stream.test.ts`; provider manager catalog fixtures.

- [ ] Write failing fixtures for Interactions requests to the fixed Google endpoint with x-goog-api-key, store:false, streaming, correct system/context separation, function declarations, model discovery pagination, and all four tools.
- [ ] Include multi-call output, fragmented function arguments, required thought/native continuation across a repair, blocked/truncated responses, network abort, key/quota/model errors, and empty/incompatible model catalogs.
- [ ] Run `npx vitest run tests/integration/gemini-provider.test.ts tests/unit/gemini-stream.test.ts` and confirm expected failures.
- [ ] Implement native Interactions translation and bounded terminal-event parsing; flatten tool names reversibly, preserve required native output items only within scope, and normalize completed calls/metadata. Use local Zod validation rather than assuming provider schema acceptance establishes semantic validity.
- [ ] Verify capability/schema compatibility using all actual tool schemas. If serialization is rejected, implement an explicit provider-specific schema/envelope adapter with the same canonical validators; never silently omit schema branches. Scope/cancel all pagination and inference work.
- [ ] Pass fixtures and, once an actual key is entered after approval, one bounded live schema test. Separate fixture success from live evidence and record the actual model ID. Review/commit the focused adapter.

### Task 5: Groq Chat Completions adapter

**Files:** groq-provider.ts, groq-stream.ts, schema-adapters.ts. Tests: `tests/integration/groq-provider.test.ts`, `tests/unit/groq-stream.test.ts`, and provider capability fixtures.

- [ ] Write failing fixtures for https://api.groq.com/openai/v1/chat/completions, Bearer authentication, messages, nested function definitions, stream:true, reversible flattened tool names, exact model IDs, and all four canonical tool schemas. Query https://api.groq.com/openai/v1/models, then verify text/local-tool capabilities; exclude speech-only and guard-only models. Model listing alone must not imply project inference permission.
- [ ] Cover assistant tool_calls followed by matching role:tool/tool_call_id results, fragmented/interleaved argument deltas, conflicting duplicate IDs, missing completion/[DONE], text-only stop, length/content_filter finish reasons, malformed tool arguments, abort, tool_use_failed, rate/credit exhaustion, and project/model permission failures. Use role:tool, tool_call_id and content without unsupported messages[].name. Route sanitized tool-generation failures through the existing repair budget without executing failed_generation text or inventing call/tool-result IDs. Invalid request/schema errors must not be retried as generated-content repairs.
- [ ] Add a regression asserting streaming+tools never includes response_format:json_schema, unsupported store/namespace fields, or an unverified strict flag. Test full teacher/schema/context token budgets and bounded handling of token/request rate limits. If a validated model requires schema-envelope fallback, use a separate stream:false/no-tools request and retain identical local validators.
- [ ] Run `npx vitest run tests/integration/groq-provider.test.ts tests/unit/groq-stream.test.ts tests/unit/ai-schema-adapters.test.ts` and confirm the adapter-specific failures.
- [ ] Implement Groq Chat Completions translation and its bounded SSE parser. Assemble calls by choice/tool index and call ID; require finish_reason:tool_calls and [DONE] before accepting normalized function actions. Text-only stop can enter bounded repair but never become a beat. Preserve paired assistant/tool feedback only within provider/model/credential scope. Reject unknown functions before coordinator dispatch; retain existing byte/argument/timeout/repair bounds. Reasoning parameters are model-specific, and reasoning text is never narrated.
- [ ] Pass tests and an opt-in bounded real-key schema/tool check after approval. Record the actual Groq-hosted model ID and provider request/usage metadata without secrets, then review/commit. Catalog connection, actual generation, and teaching quality remain distinct acceptance claims.

Tasks 4 and 5 can run in parallel after Tasks 1–3 establish interfaces; coordinate any shared schema/parser edits.

### Task 6: Route every teaching workflow and scope saved history

**Files:** app.ts, ipc-router.ts, all three coordinators, session-repository.ts, protocol/preload/renderer bridge contracts. Extend model-selection, coordinator, course, source, and storage integration tests.

- [ ] Write failing tests that successful Gemini/Groq key connection immediately routes topic planning, source summaries, courses, concept starts, questions, and continuation to that provider while ChatGPT is disconnected, with no separate provider selection call. Add active-provider/key/model changes during each operation and regression tests retaining the existing ChatGPT request/auth behavior.
- [ ] Add persistence tests for old untagged ChatGPT events, provider-tagged provenance, no cross-provider replay, restart, and exports. Add a course-summary cache test whose provider/model/prompt-schema identity changes while document identity stays constant.
- [ ] Run the targeted tests to confirm failures, then replace concrete provider injection and ChatGPT-only authorization gates with manager snapshots. Update all three coordinators to use canonical messages/tools/results and compare the full selection snapshot before committing or scheduling continuation.
- [ ] Preserve current repair counts, source-range validation, canvas revision checks, maximum two staged teaching beats, simulation preflight, presentation receipts, and current abort semantics. On provider switch preserve committed immutable beats (including a partially presented beat's remaining chunks) for explicit local resume/replay, while clearing uncommitted work/prefetch and revoking automatic continuation. Do not replay or acknowledge on switch. Test that the old beat retains its provenance and the next fresh generation uses the new provider with presented-state context. Extend metadata sanitization so providerId is actually persisted.
- [ ] Tag native history and replay it only in compatible provider/model/credential/account scope. Old untagged native rounds remain readable as ChatGPT provenance but are not replayed after migration. Rebuild context from canonical saved state after a switch or scope mismatch; never send ChatGPT/Gemini/Groq native records to another service. Drop whole oversized native rounds, never truncated signed records or orphaned call/result pairs. Scope source-summary caches and retain old lessons without a table migration.
- [ ] Add trusted-top-frame IPC handlers for provider configuration/key changes/selection; strict-parse bounded arguments and return public metadata only. Keep the browser-preview bridge safely unavailable for remote inference.
- [ ] Run `npx vitest run tests/unit/model-selection.test.ts tests/unit/ipc-boundary.test.ts tests/integration` plus new manager tests; review/commit after relevant suites pass.

### Task 7: Provider settings, readiness, and safe switching in the UI

**Files:** TeachingSettings.tsx, its test file, App.tsx, bridge.ts, and minimal shared settings CSS. Follow existing UX-CONTRACT and frontend design guidance; no visual redesign.

- [ ] Write failing UI tests for masked key Connect/Replace automatically activating Gemini/Groq without an additional provider switch, optional manual selection among saved providers, key removal, exact model restore, unavailable/empty catalogs, quota/model errors, stale responses, and settings reopening without displaying keys.
- [ ] Test all entry points with ChatGPT disconnected: topic CTA, source-course CTA, typed/microphone questions, understanding checks, concept starts, and automatic continuation. Offline saved replay must remain usable.
- [ ] Run the focused renderer suites, then implement teaching connection controls within the existing modal. Show official ChatGPT sign-in for ChatGPT and provider key controls for Gemini/Groq. Connect/Replace drives automatic activation; settings may still offer switching among saved connections or returning to ChatGPT. Replace ChatGPT-only canTeach checks/copy with active-provider readiness while preserving existing ChatGPT behavior.
- [ ] Before an active provider/model/key change, pause/checkpoint presentation and cancel obsolete work. Preserve committed beat/checkpoint data for explicit local resume, including partially presented chunks; switching itself never resumes playback. Do not pause merely because someone types into an inactive key field. Preserve the independent Teacher narration section and its saved choices.
- [ ] Remove only the persistent "ChatGPT connected" wording from the header and sidebar account subtitle (audited App.tsx:545 and :541). Do not replace it with another service-connected label. Keep account/settings targets, account name, indicators, requested/served model line, canvas, controls, and remaining layout. Keep the independent temporary sign-in toast. Add tests that both permanent labels are absent while settings/account controls and existing ChatGPT teaching still work.
- [ ] Show selected provider/model and connection recoveries inside Settings only. Disclose selected-service teaching-context/material-excerpt transmission and API usage there; catalog connection is not displayed as verified teaching. Test successful connect followed directly by Start lesson and restart without another switch; failed connect must retain the previous active provider/model.
- [ ] Pass UI, playback, microphone/voice, and ElevenLabs tests; review/commit the focused UI change.

### Task 8: Whole-workflow regression and opt-in real-provider acceptance

**Files:** tests/e2e/ai-providers.spec.ts, reusable isolated provider fixtures, eval-live.mjs, validation report.

- [ ] Build synthetic Gemini/Groq main-network fixtures using dummy keys and isolated profiles. Exercise key connect → automatic provider/initial-model activation → roadmap → teach/draw → simulate/change control → interrupt/question → continuation → save/reopen, without a manual provider switch. Include explicit model recovery for a remembered unavailable model and optional manual changes in Settings.
- [ ] Cover supplied-material course planning/citations, rejected generated simulation repair, provider switch during stream/planning/playback, revoked keys, same-ID cross-provider selections, changed canvas, and incompatible native history. Retain local/ElevenLabs narration and actual playback receipt tests.
- [ ] Generalize eval-live.mjs to explicit provider/model selection and isolated opt-in profiles. Never reuse or copy the original credential profile for tests.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then the appropriate desktop Playwright suites. Require actual green outputs; distinguish sandbox infrastructure failures from application failures.
- [ ] After the user enters keys directly in app, verify Connect/Replace automatically routes the next generation to that provider; run one short real Gemini-only lesson and one Groq-only lesson with ChatGPT disconnected, plus a bounded source/structured-tools check. Verify the two persistent front-screen connected labels are absent. Record real model, valid visuals/simulation, follow-up, cancellation, and voice behavior; disclose any unverified acceptance item.
- [ ] Review the full diff and fix concrete regressions before delivery; do not broaden into unrelated visual/attachment work.

### Task 9: Package and deliver the approved desktop update

**Files:** root/desktop manifests and lockfile, README/DESIGN/UX-CONTRACT as needed, new validation report, release artifacts. Proposed version: 0.3.0, subject to the actual version at implementation time.

- [ ] Update setup/privacy/troubleshooting instructions and evidence labels. Keep appId, profile discovery, lesson storage, and shortcut identity stable.
- [ ] Build a Windows installer and run packaged provider/settings, restart, offline playback, minimize/relaunch, and Start shortcut smoke checks against isolated profiles.
- [ ] Install the tested artifact under the approved implementation scope after saving/closing the running app as necessary. Preserve user data and both speech/provider settings; verify the installed artifact matches the tested package.
- [ ] Deliver installer/executable paths and concise validation results. No GitHub push, release publication, or unrelated project changes without a separate request.

## Approval checkpoint

Approval was received and the v0.2.0 source/baseline was confirmed. Shared contracts, protected connection management, both native adapters, all teaching routes, settings, and live-evaluation tooling are implemented. Automated and desktop fixture checks are recorded in the execution ledger. Packaging/installation and real-key acceptance are tracked separately; no fixture outcome is represented as live provider inference.
