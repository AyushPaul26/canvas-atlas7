# Canvas Atlas Voice, Visuals, and Reference Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development after explicit approval. Steps use checkbox (`- [ ]`) syntax. Do not start implementation until the user says “go.”

**Goal:** Add selectable ElevenLabs account narration, explorable teaching visuals, and reference attachments during an active lesson.

**Architecture:** Keep the existing PCM/audio clock and trusted renderer boundaries. Add provider and visualization adapters behind typed contracts, then add a shared local ingestion/evidence pipeline and per-message attachments. Persist new state with an additive migration rather than rewriting existing lessons.

**Tech Stack:** Electron, React 19, TypeScript, SQLite, current Three.js/Konva/KaTeX/QuickJS/PDF.js; proposed JSXGraph, Matter.js, and Mammoth. Motion is optional interface polish; React Three Fiber is a researched alternative, not a required migration.

**Spec:** [Research, design, limits, and user decisions](../specs/2026-10-29-voice-visuals-references-design.md).

**Status:** The user approved ElevenLabs first on 29 October 2026. Tasks1–2 are implemented and fixture-verified for local version0.2.0; user-entered-key/live-provider acceptance remains pending. Visual and attachment tasks remain proposed and unimplemented. No GitHub update/public release is requested.

## Global constraints

- Execute in order: existing ElevenLabs account voice, interactive visuals, then references in the lesson composer. No voice cloning/design in this scope.
- Keep official ChatGPT account integration, local microphone recognition, existing scenes/lessons, current branding, and the repaired Start-menu lifecycle.
- One authoritative audio clock, scoped synthesis cancellation, one-chunk prefetch, immutable accepted beats, and actual audio/visual completion receipts.
- Key stored by OS protection in main only; source materials ingested through validated main/isolated-host paths. No renderer network relaxation.
- Five attachments/50 MiB per message; individual PDF25 MiB, DOCX10 MiB, image10 MiB, text1 MiB. At most four normalized image/page renders per provider request, 2 MiB each, 12 MiB serialized request cap. Apply all remaining limits in the spec.
- Fixed-step physics1/60s, bounded declarative math/physics inputs, keyboard and static fallbacks. Existing generated programs remain isolated.
- Additive database v3 with v2 backup and version-aware compatibility. Preserve originals and referenced assets.
- Wait for “go” before implementing, testing live services, packaging, or updating the local app. Propose local version0.2.0; update through the normal save/close path. Commit, push, and public release publication require a corresponding user request.

## Review focus

1. Voice changes and canceled previews must not leak stale paid synthesis into the current lesson or cancel unrelated recognition (Tasks1–2).
2. Manual graph/object/camera changes must survive audio frames, feed teacher context, and reconcile safely on resume/replay (Tasks3–4).
3. Mixed ready/failed/processing references and voice auto-send must preserve the draft and never submit a partial selection silently (Tasks5–7).
4. Images must reach an eligible model as image inputs; oversized, unsupported, and prompt-like source content must not become unbounded requests or privileged instructions (Tasks5–7).
5. Old lessons, references shared across turns, incomplete drafts, unsupported engine versions, and the real Start shortcut must remain recoverable after upgrade (Tasks3–8).

## Task 1: ElevenLabs provider and protected configuration

**Files:** Create `apps/desktop/src/main/voice/elevenlabs-client.ts`, `elevenlabs-key-store.ts`, `speech-provider.ts`; modify main `app.ts`, `voice/voice-worker-manager.ts`, `ipc-router.ts`, preload `app-bridge.ts`, renderer `bridge.ts`, protocol `core.ts`, voice `contracts.ts`. Add provider/key-store tests under `tests/unit/` and extend IPC boundary tests.

**Interfaces:** `VoiceConfiguration` exposes provider (`local|elevenlabs`), key presence, voice ID/name, supported model/settings, and connection state. Add `getVoiceConfiguration`, `saveVoiceConfiguration`, `setElevenLabsKey`, `clearElevenLabsKey`, and paginated `listElevenLabsVoices`. `synthesizeSpeech(text, {requestId,purpose})` returns the existing PCM shape; `cancelSpeech(requestId)` aborts only that job.

- [ ] Write failing tests for encrypted persistence/removal, trusted IPC, paginated voices, correct request construction/PCM decode, quota/auth/offline/timeouts, oversized/malformed responses, and aborted/stale jobs.
- [ ] Run the named new tests and record the expected failures before adding the provider.
- [ ] Implement main-only catalog/TTS requests, bounded public results, compatible model/settings checks, protected key persistence, and local/cloud routing. Keep recognition separate.
- [ ] Run new provider tests plus existing credential, IPC, and local voice tests; verify a local provider never sends ElevenLabs requests.

## Task 2: Voice settings and playback integration

**Files:** Create `apps/desktop/src/renderer/voice/VoiceSettings.tsx` and tests; modify `App.tsx`, `styles.css`, `useVoice.ts`, `audioPlayback.ts`, their tests, DESIGN.md, and UX-CONTRACT.md. Extend a desktop voice fixture.

**Interfaces:** Consume Task1 configuration/catalog/PCM/cancellation methods. Each settings generation invalidates prepared audio. Preview is a separate scoped request and cannot write lesson progress.

- [ ] Add failing tests for account voice search/load-more, selected voice restart persistence, key removal, invalid voice, preview stop, voice switch during preparation, and stale prefetch.
- [ ] Implement provider selection, masked key controls, catalog search/preview, supported tuning, one speed control, and provider-specific status/data-use copy in the existing settings design.
- [ ] Wire cancellation, preview isolation, and controlled paused settings changes into the existing audio adapter. Preserve next-chunk prefetch on ordinary chunk transitions.
- [ ] Run settings/audio/useVoice/lesson-playback tests and a desktop cloud-PCM fixture. When the user enters a key, validate one real chosen-voice preview and a short synchronized lesson before declaring Phase1 live-verified.

## Task 3: Visual interaction contract and explorable Three.js scenes

**Files:** Extend protocol `visuals.ts`, `core.ts`, and `playback.ts`; scene `timeline.ts`; teacher `visual-instructions.ts`/`tool-schema.ts`; renderer `visuals/Scene3D.tsx`, `VisualStage.tsx`, `visual-adapters.ts`, `useLessonPlayback.ts`, and relevant App orchestration. Create `visuals/interaction-state.ts` with tests; extend spatial and visual desktop checks.

**Interfaces:** Define versioned `InteractiveVisualSpec`, `VisualStyle` (`board|science-lab|math-graph|process`), and `VisualInteraction` (`select|inspect|set-parameter|drag-point|camera|reset`). Interactions carry lesson/beat/visual IDs and validated values. A learner exploration state owns temporary camera/parameters independently of accepted narration poses.

- [ ] Add failing schema and timeline tests for unknown objects, invalid/nonfinite values, stale beats, manual camera overwrite, Explore pause, resume reconciliation, and engine-version recovery.
- [ ] Add schema-bounded selection/labels, OrbitControls with reset and keyboard alternatives, learner-owned camera state, and validated state propagation back to teacher context.
- [ ] Persist interaction state without mutating immutable accepted beats or treating exploration as mastery. Old scenes render with their existing defaults.
- [ ] Run scene/timeline/playback tests and real desktop 3D interaction/context-loss checks. Verify no independent animation clock advances the lesson.

## Task 4: Educational math and mechanics adapters

**Files:** Create `renderer/visuals/MathGraph.tsx`, `math-adapter.ts`, `packages/simulation/src/physics-spec.ts`, and `matter-runtime.ts`; extend `apps/simulation-host/src/simulation.worker.ts`, `runner.ts`, desktop sandbox routing, protocol simulation contracts, checkpoint validation, teacher instructions, and related unit/integration/desktop tests. Modify dependency manifests/lockfile after approval.

**Interfaces:** JSXGraph consumes a validated `MathVisualSpec` with allowed primitives and bounded numeric function representation. The simulation artifact union supports legacy QuickJS and a versioned declarative `rigid-body-2d` engine. Both return the existing bounded scene/measurement envelope and share fixed-step input/checkpoint semantics.

- [ ] Test draggable-point/slope updates, bounded math inputs, invalid domains, collision/constraint outputs, step limits, reset, same-version replay, old QuickJS artifacts, and unsupported engine versions before implementation.
- [ ] Add one math adapter and one isolated Matter.js adapter with 1/60s stepping, explicit units/assumptions, worker watchdog, resource disposal, and validated material/body/constraint limits. Keep arbitrary generated code outside trusted renderers.
- [ ] Add coherent style/legend/measurement presentation. Teacher requests choose renderers by explanatory need; do not route solely by a hardcoded subject-name catalogue.
- [ ] Run deterministic domain fixtures and desktop pointer/keyboard interaction tests. Check compact/large viewport layout, reduced motion, CPU/GPU use, and fallback. Label demonstrations honestly as illustrative unless separately checked.

## Task 5: Shared local attachment ingestion and database migration

**Files:** Create protocol `attachments.ts`, main `attachments/attachment-service.ts`, `storage/attachment-repository.ts`, document-host `docx.ts`, and image normalization helpers; modify `storage/database.ts`, `session-repository.ts`, existing document service/repository/host, and parser host contracts. Add migration, ingestion, bounds, ownership, and cleanup tests.

**Interfaces:** `AttachmentManifest` holds managed ID/hash/type/name/status/coverage/preview and extraction version; no arbitrary renderer paths. Persist session/message attachment associations, composer draft IDs/text, and supplied-evidence records. `AttachmentService.ingest(...)` accepts main-authorized file selections or bounded pasted bytes, and returns managed references. Reuse document extraction rather than adding a competing course parser.

- [ ] Add failing tests for v2→v3 backup/migration, unchanged old lesson reads, PNG/JPEG/WebP/PDF/DOCX/TXT/Markdown ingestion, duplicate hashes, mixed failures, canceled imports, and cross-session ownership.
- [ ] Test MIME signature mismatch, file/total/pixel/archive/time limits, symlinks/unauthorized paths, DOCX external references, corrupted/password-protected files, draft cleanup, and shared-source retention.
- [ ] Implement bounded image normalization, local PDF extraction/page preview, terminable Mammoth raw-text DOCX extraction, explicit format-loss warnings, common manifests, and additive storage. Keep course limits distinct from per-turn reference limits.
- [ ] Run storage/document/import suites and a native fixture importing the supported formats. Verify no source HTML, scripts, or external relationships execute.

## Task 6: Reference-aware multimodal teaching

**Files:** Extend `main/ai/lesson-coordinator.ts`, `chatgpt-provider.ts`, `documents/source-index.ts`, main wiring, teacher context/instructions, session history/export, and source validation. Create `main/ai/reference-context.ts` and integration tests.

**Interfaces:** `sendMessage` accepts `attachmentIds?: string[]` alongside existing text/selection IDs. `ReferenceContext` contains bounded canonical text excerpts, explicit visual evidence IDs, normalized image inputs, and supplied provenance. Text `SourceRef` and image evidence references remain distinct. Current reference associations participate in relevant follow-ups/continuation.

- [ ] Add failing tests that prove screenshot bytes become `input_image` content, selected PDF pages are bounded, deep text is retrievable, irrelevant references are not blindly resent, and citations cannot claim unsupplied source evidence.
- [ ] Test image-ineligible account/model recovery, provider rejection, new references during active source lessons, source prompt injection, and image analysis limits while preserving the original draft/checkpoint.
- [ ] Implement actual image input construction and bounded retrieval through the existing provider. Verify official account/model eligibility live; require explicit compatible-model selection when necessary, never substitute silently or represent thumbnail display as vision.
- [ ] Persist the actual references/evidence associated with each turn; make excerpts/images available on local reopen. JSON exports include attachment metadata and bounded textual evidence, exclude original file bytes/private paths, and explain local-source requirements. Existing Back to lesson preserves the interrupted accepted explanation.
- [ ] Run provider/context/grounding/history tests and one real image-plus-question trial after account access is available; record the actual selected model and supplied evidence.

## Task 7: In-lesson attachment composer

**Files:** Create renderer `composer/LessonComposer.tsx`, `AttachmentTray.tsx`, and their tests; modify App question/send/voice orchestration, preload bridge, IPC routes, renderer bridge, source-preview UI, styles, DESIGN.md, and UX-CONTRACT.md.

**Interfaces:** Add explicit native-pick, user-invoked clipboard, authorized drop/paste ingestion, preview, draft-save, detach, and cancellation commands. Consume managed IDs from Task5 and Task6 `sendMessage`. All methods retain trusted-frame validation and main-side ownership checks.

- [ ] Write failing tests for pasted image+text, drop/pick, native file-list paste fallback, ordinary text paste, attach-only Send, five-file limits, pending/failed attachments, remove/retry, navigation, draft restoration, and voice auto-send while preparing.
- [ ] Add paperclip, Ctrl+V, drop target, bounded attachment chips, preview, per-file status, and cancel/retry. Pause and checkpoint teaching when adding material; submit only on Send. Preserve text/IDs on failure.
- [ ] Wire spoken questions to the same selected references without starting an automatic upload during preparation or silently dropping failed files. Send attachments as a follow-up branch, not an automatic new course.
- [ ] Run composer/App tests and packaged native clipboard/picker/drop checks at 1050×760 and 1440×940, including keyboard navigation and visible Pause/question controls.

## Task 8: Integrated acceptance and release preparation

**Files:** Update build/version/validation documentation as appropriate; add focused desktop tests for the complete flows and extend existing recovery/activation tests. Use a separate build output directory.

- [ ] Run typecheck, lint, the full automated suite, production build, and focused desktop suites after integration; review only new failures/risks rather than repeatedly rebuilding unchanged code.
- [ ] Verify all phases together: chosen voice, interactive visual, pasted screenshot/PDF/DOCX question, source-based response, Back to lesson, replay, restart, and local/cloud recovery.
- [ ] Check no secrets or private reference assets enter source control or exported account configuration. Record live versus fixture evidence and limitations; preserve dependency notices.
- [ ] Prepare a new versioned Windows installer and verify its actual Start shortcut, activation, old profile migration, and existing lesson/material continuity. Close active work through the normal checkpoint path before installation.
- [ ] Present the concrete verified build and validation record. Publish/update GitHub or a public release only if the user requests it; do not treat earlier publication of version0.1.1 as blanket release authorization.

## Before implementation

The user only needs to approve/correct this proposal with **“go.”** The chosen account voice and API key can be entered when Phase1 settings are ready. No additional repository choice is needed for the recommended approach. If the user specifically wants a Fiber migration, original/cloned voice, legacy `.doc`, or a talking avatar, revise scope before building those additions.
