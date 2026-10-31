# Canvas Atlas Visual Learning Companion Implementation Plan

> **Status: approved and delivered on 23 October 2026.** The user's “okayy go on” approved all nine tasks. The implementation preserves the existing uncommitted reliability and rename changes. See the [execution and validation record](../../canvas-atlas-visual-companion-validation.md) for actual coverage, artifacts, and limitations.
>
> **For agentic workers:** After approval, use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task by task. Keep shared contract and integration changes sequential; delegate independent renderer and document work after contracts are settled.

**Goal:** Upgrade the existing Canvas Atlas desktop app so learners hear a natural explanation while seeing a relevant, evolving demonstration, with topic roadmaps and source-grounded document courses.

**Architecture:** Extend the current validated teaching-beat pipeline with a learner-visible roadmap, structured narration chunks, and declarative visual cues. A shared playback controller coordinates local audio, trusted renderers, experiments, and acknowledged progress. Local document processing and course storage feed bounded evidence into the existing ChatGPT provider.

**Tech stack:** Existing Electron, React, TypeScript, SQLite, Konva, RoughJS, KaTeX, QuickJS, Whisper, and Kokoro/SAPI. Proposed additions: bundled PDF.js for local PDFs and Three.js for bounded spatial scenes; select compatible pinned versions and inspect licenses during implementation, after approval.

**Spec:** [Original upgrade brief](<C:/Users/Ayush Paul/.codex/attachments/ff8961c6-5e1f-41b0-a474-c94e185eac8c/Pasted text.txt>). Existing product constraints: `DESIGN.md`, `UX-CONTRACT.md`, `docs/INTEGRATION.md`. This plan proposes the necessary roadmap/playback updates to those contracts.

## Global constraints

- Work directly in the existing app; retain **Canvas Atlas** branding, current design language, authentication, model selection, editable canvas, local voice, saved lessons, and simulation isolation.
- Preserve all current uncommitted reliability and rename changes. Internal compatibility identifiers and existing user-data paths remain stable.
- No rebuild from scratch, API key requirement, replacement model backend, or new external AI service.
- Use the selected account's actual model catalog and the existing OAuth Responses connection. Keep `store:false`, `stream:true`, namespaced tools, terminal-event checks, cancellation, bounded queues, and validation.
- Learning content and roadmaps are generated for the learner's topic/material. Renderer primitives are reusable; completed lessons are not canned content.
- Visual instructions are data. Generated JavaScript stays inside the existing QuickJS simulation boundary; no generated scripts, HTML, shaders, or remote assets enter the renderer.
- Save only acknowledged progress. Prepared content, audio completion, visual completion, concept coverage, and demonstrated understanding are distinct states.
- Keep current serialized size/node/depth limits and the full 6,000-character accepted learner request. New envelopes receive explicit additive budgets rather than silently reducing existing allowances.
- Initial document formats: **PDF, UTF-8 TXT, and Markdown**. Word/slides can be exported to PDF. OCR, handwriting recognition, native DOCX/PPTX parsing, arbitrary 3D asset generation, and a replacement voice engine are outside this implementation.

## Findings behind the design

The provider already uses `GET /v1/models` and streamed `POST /v1/responses`. Konva renders validated primitives; QuickJS runs isolated numeric experiments. Local female Kokoro `af_heart` and Windows voice fallback already exist. These are suitable foundations.

The current visual reveal uses a fixed per-object timer, while speech and experiments run independently. `App.tsx` can replace an unheard narration tail with timed text and then acknowledge full completion. Simulation startup is not awaited. Pause cancels rather than retaining a resumable presentation. There is no topic roadmap, document ingestion, or course state. SQLite already has an unused `playback_checkpoints` table, and full prepared beats survive in the event log even when snapshot beats contain only presented prefixes.

Official documentation confirms this account route supports text, and image/file inputs when the selected model accepts them. It does **not** support the Files upload or transcription APIs, hosted file search, image generation, or Code Interpreter. The proposed baseline therefore extracts documents locally and sends bounded text evidence through the existing provider; it does not depend on unverified multimodal capabilities. See [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) and [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## Recommended approach and learner flow

Choose **structured teaching segments with a shared playback clock**. Enhancing only the current reveal timers would leave pause, replay, and failure accounting inconsistent. Free-form generated webpages would duplicate the existing renderer and weaken control. The recommended approach preserves current code and gives each narration segment an explicit visual purpose.

Topic → generate compact roadmap → **Start Teaching** → current concept with a large visual workspace → purposeful understanding check → next concept. Upload → local extraction and coverage warnings → generated course-outline preview → select lesson → the same teaching experience.

The teaching screen keeps the existing sidebar, fonts, palette, and whiteboard. A concise concept title and progress indicator sit above the visualization. Pause/Resume, Replay, a question field/microphone, Simpler, and Revisit stay available without opening the transcript. Transcript and full roadmap are collapsible. Source references open the actual local page/section. Technical diagnostics stay in Settings.

## Proposed contracts and ownership

| Area | Contract / responsibility |
|---|---|
| Learning plan | `LearningPlan {id, version, title, sourceDocumentIds, concepts}`; concepts have stable IDs, objectives, prerequisite IDs, and verified source references. Validate acyclic prerequisites and unique IDs. |
| Teaching segment | Extend `TeachingBeat` compatibly with `conceptId`, `chunks: NarrationChunk[]`, `cues: VisualCue[]`, source references, and optional bounded spatial scene. Chunk texts concatenate exactly to `narration`. Legacy beats are split deterministically at sentence/word boundaries, retain their original board, and gain no invented historical cues. |
| Narration / cues | `NarrationChunk {id, text}`; `VisualCue {id, chunkId, at, action}`. `at` is chunk start/end or normalized progress. Actions are closed unions for visibility, highlight, numeric tween, camera, and validated experiment controls. |
| Playback | `PlaybackCursor {beatId, chunkId, offsetSeconds, passId}`; `PlaybackCheckpoint` also records completed chunks, applied cues, baseline/visible state, and simulation checkpoint. Review position is separate from furthest covered concept. |
| Result / evidence | `AudioResult` distinguishes completed, paused, interrupted, failed, and unavailable. `PresentationReceipt` identifies the immutable accepted beat, plan version, playback pass, and actual chunk/visual acknowledgements. Only successful required presentation advances coverage. |
| Learning progress | `LearningProgress {planId, planVersion, activeConceptId, conceptStates, pendingCheck?, branchReturnPoint?, status}`. States distinguish planned, teaching, paused, checking, and completed; checks retain answered/help-requested/skipped evidence. Revisit changes the cursor without erasing coverage. |
| Sources / courses | `SourceRef {documentId, extractionVersion, sectionId, page?, start, end}`; offsets use UTF-16 indices in canonical extracted section text, and pages retain physical index plus displayed label. `DocumentManifest` records extraction status/coverage/warnings. `CourseRecord` binds a plan, materials, lesson sessions, and progress. Models may cite only supplied source IDs/ranges. |

Split new protocol responsibilities into `packages/protocol/src/learning.ts`, `playback.ts`, `documents.ts`, and `visuals.ts`, re-exported by `index.ts`. Keep existing imports working. A pure `packages/scene/src/timeline.ts` evaluates declarative cues; React playback and renderer adapters own effects.

Proposed limits: at most 40 concepts per topic roadmap, 30 lessons per course outline, 16 chunks per beat, 240 characters per chunk, and 128 cues per beat. Keep the existing two-beat queue and two repair attempts. Trusted 3D permits at most 128 primitive nodes and 50,000 total vertices, finite bounded transforms, bundled materials, and a required explanatory 2D fallback. Document limits are defined in Task 6. These are starting product limits to validate, not claims about current capability.

## Review focus

1. Voice unavailable, muted, or synthesis/playback failure: never claim the audio lesson was heard or automatically complete it through timed text.
2. Late events during pause, replay, question, model/account change, navigation, or close: never advance the wrong presentation or duplicate messages/progress.
3. Mixed/scanned, mathematical, password-protected, corrupt, or oversized documents: show extraction coverage and preserve usable evidence without fabricated content.
4. Invalid cues, incorrect citations, failed experiments, or lost WebGL: retain a useful board, explain the failure, and block false completion.
5. Old saved lessons, a failed database migration, full disk, or restart mid-chunk: preserve data and resume conservatively from acknowledged work.

---

## Task 1: Preserve the baseline and pin integration behavior

**Files:** inspect `main/ai/chatgpt-provider.ts`, `main/auth/chatgpt-auth.ts`, `main/ai/tool-stream.ts` under `apps/desktop/src`; extend `tests/integration/chatgpt-provider.test.ts` and `docs/INTEGRATION.md` only where needed.

**Interfaces:** Keep `ChatGPTProvider.complete(request: ProviderRequest, signal: AbortSignal)` and `listModels()` unchanged. New planning calls use this same instance and selected model.

- [ ] Record the current working diff and run baseline typecheck, lint, unit/integration, and ordinary desktop E2E after approval. Preserve unrelated/uncommitted work.
- [ ] Add any missing provider regressions for namespaced planning tools, streamed terminal errors, unavailable selected model, and no unsupported request fields; prove new tests fail before changes if a gap exists.
- [ ] Document supported capabilities and local-only document/audio boundaries. Do not add image/file inference to the critical path.
- [ ] Run `npm run test:integration -- tests/integration/chatgpt-provider.test.ts`; require all relevant provider tests to pass. Reserve one small live same-account text/tool check for final acceptance, with no secrets in output.

**Deliverable:** A preserved baseline and verified contract for subsequent requests. No auth rewrite.

## Task 2: Add learning, source, and playback persistence contracts

**Files:** new protocol modules above; modify `packages/protocol/src/index.ts`, `apps/desktop/src/main/storage/database.ts`, `session-repository.ts`; create `course-repository.ts` and `document-repository.ts` beside them. Tests: `tests/unit/learning-protocol.test.ts`, `tests/integration/learning-storage.test.ts`.

**Interfaces:** Define the contracts in the table. Add repository methods `savePlan(sessionId, plan)`, `savePlayback(sessionId, checkpoint)`, `loadPlayback(sessionId)`, `createCourse(plan, documentIds)`, and `loadCourse(courseId)`, with inferred protocol types and transactional writes.

- [ ] Write failing validation tests for duplicate/missing IDs, cyclic prerequisites, unknown cue targets/chunks, nonfinite values, out-of-range source offsets, and aggregate byte/node limits.
- [ ] Write migration/recovery tests using a copy of a version-1 fixture: original lessons/events remain readable, partial migration rolls back, newer versions refuse safely, and save failure cannot advance progress.
- [ ] Implement a transactional version-2 migration for documents, sections, assets, courses, concept progress, and plan links; reuse `playback_checkpoints`. Update both database and repository version guards. Back up the real database before its first migration after approval.
- [ ] Preserve immutable accepted segments and scene baselines separately from visible/heard snapshots. Adapt old beats on load; never fabricate old completion or understanding evidence.
- [ ] Run the two new test files plus existing protocol/session-storage tests; require all to pass.

**Deliverable:** Backward-compatible storage and validated shared contracts. Depends on Task 1.

## Task 3: Generate and teach an explicit topic roadmap

**Files:** create `packages/teacher/src/planner.ts`, `apps/desktop/src/main/ai/learning-plan-coordinator.ts`; modify teacher `index.ts`, `lesson-coordinator.ts`, `main/app.ts`, `main/ipc-router.ts`, `preload/app-bridge.ts`, renderer `bridge.ts`; tests `tests/integration/learning-plan.test.ts`.

**Interfaces:** Add `TutorBridge.planTopic({sessionId, level?}): Promise<LearningPlan>` and `startConcept({sessionId, conceptId}): Promise<void>`. `LearningPlanCoordinator.planTopic(...)` uses a strict namespaced `planning.propose_plan` tool through the existing provider. Generation status/errors use typed events and request epochs.

- [ ] Write failing tests proving topic submission plans without speaking; Start Teaching explicitly starts the selected concept; different subjects receive genuinely different model-generated roadmaps.
- [ ] Implement compact objectives/prerequisites from the learner's topic and explicit needs. Permit one useful clarification when necessary; offer a concise editable level preference without a mandatory questionnaire.
- [ ] Update teacher instructions to expose the concise roadmap while keeping internal orchestration hidden. Generate chunks/cues for the current concept; keep the existing bounded queue and repair policy.
- [ ] Implement concept transitions, understanding checks, revisit, and materially different explanations after confusion. Questions interrupt pending output and retain the roadmap return point. Passive playback records coverage, never mastery.
- [ ] Test full-length questions, stale planning responses/model changes, unavailable models, duplicate Start clicks, and malformed plans. Run the new integration tests plus teacher/coordinator/continuation regressions.

**Deliverable:** A real topic plan and concept-by-concept teaching state. Depends on Task 2.

## Task 4: Build resumable audio-led presentation

**Files:** create renderer `useLessonPlayback.ts` and `audioPlayback.ts`; modify `useVoice.ts`, `App.tsx`, coordinator/repository progress handling, protocol bridge declarations; tests renderer `useLessonPlayback.test.tsx` and `tests/integration/playback-progress.test.ts`.

**Interfaces:** `AudioPlayback.play(chunk, cursor, callbacks): Promise<AudioResult>`; `pause()`, `resume()`, `stop()`. `useLessonPlayback` owns prepare/play/pause/resume/replay/interrupt and emits `PresentationReceipt`. Add bridge `savePlayback(...)` and `resumePlayback({sessionId, mode:'resume'|'replay'})` using validated accepted content under a fresh epoch.

- [ ] Write failing tests for paused audio/cues, mid-chunk interruption, voice failure/unavailable/mute, replay without duplicate messages/continuation, and checkpoint write failure.
- [ ] Remove the timed-text substitution for unheard audio. Require successful required audio and visual receipts before completing a segment; keep a failed lesson paused with Retry. A muted visual review does not count as heard audio.
- [ ] Use `AudioContext.currentTime` and actual PCM duration as the playback clock; pause active PCM by suspension. Treat within-chunk pacing as estimated. Fallback voice starts timing on actual utterance start and uses sentence boundaries; if reliable in-chunk resume is unavailable, restart the current chunk explicitly.
- [ ] Keep one-chunk prefetch. On application restart, resume at the last completed chunk, showing that the interrupted chunk will replay. Retain accepted content rather than requesting a different explanation for simple Replay.
- [ ] Distinguish ordinary pause from an interruption that cancels generation. Reject stale callbacks by session/epoch/pass; keep the close/save handshake and actual-heard context rules.
- [ ] Run new playback tests and existing voice, renderer, coordinator, and close-checkpoint tests; require all to pass.

**Deliverable:** Honest pause/resume/replay and completion accounting. Depends on Task 2; integrates concept state from Task 3.

## Task 5: Make visual teaching evolve with narration

**Files:** create `packages/scene/src/timeline.ts`, renderer `visuals/VisualStage.tsx`, `visuals/Scene3D.tsx`, `visuals/visual-adapters.ts`; modify `SceneCanvas.tsx`, `useSimulation.ts`, teacher visual instructions, relevant build aliases/dependency files. Tests: `tests/unit/visual-timeline.test.ts`, renderer `visuals/VisualStage.test.tsx`, existing simulation tests.

**Interfaces:** `evaluateVisualFrame(beat, cursor, baseline): VisualFrame`; `VisualStage` renders a validated frame and reports readiness/failure. `useSimulation.start(...)` returns readiness; teaching-mode stepping accepts a playback target tick. Spatial scenes use a closed primitive schema and required 2D fallback.

- [ ] Write failing tests for chunk-aligned reveal/highlight/tween, deterministic replay, equation transforms, invalid targets, reduced-motion keyframes, failed experiment init, and lost/unavailable WebGL fallback.
- [ ] Replace independent teaching reveal timers with timeline frames. Support purposeful diagrams, graphs, equations, vectors, processes, comparisons, timelines/maps, and structures from the same primitives. Keep teacher layers separate from learner notes/edits so replay cannot erase notes.
- [ ] Await simulation and renderer readiness before associated audio starts. Drive teaching simulations from playback time with bounded work; pause/buffer if computation falls behind instead of unbounded catch-up. Explicit exploration pauses narration and scripted controls.
- [ ] Keep adjusted experiment values. Resuming after a learner parameter change regenerates the current short explanation from those values; ordinary pause without changes resumes accepted audio. Replay restores its accepted demonstration baseline without overwriting learner annotations.
- [ ] Add lazy-loaded trusted Three.js primitives/camera tracks for spatial concepts. No arbitrary meshes, URLs, shaders, or generated renderer code. Dispose GPU resources and use the explanatory 2D fallback when WebGL is unavailable or fails. [Three.js documents WebGL2 requirements](https://threejs.org/docs/pages/WebGLRenderer.html).
- [ ] Run timeline/renderer/simulation tests and packaged boundary regressions at final integration.

**Deliverable:** Audio-aligned evolving visuals, interactive demonstrations, and a bounded 3D option. Depends on Tasks 2 and 4.

## Task 6: Import and inspect study material locally

**Files:** create `apps/desktop/src/main/documents/document-service.ts`, `document-host.ts`, `asset-store.ts`; create `apps/document-host/src/worker.ts` and its isolated renderer entry; extend build config, typed IPC/preload/bridge; new `tests/integration/document-import.test.ts` and synthetic fixtures under `tests/fixtures/documents/`.

**Interfaces:** `TutorBridge.importStudyMaterial(): Promise<DocumentManifest[]>` uses an OS file picker. `cancelDocumentImport(jobId)` cancels work. `getSourceExcerpt(ref)` and `getSourcePreview(ref)` return bounded text or approved asset handles, never arbitrary filesystem access. Progress includes pages/sections processed and coverage warnings.

- [ ] Write failing tests for valid PDF/TXT/MD, mixed text/scanned pages, password protection, corrupt files, excessive output, cancellation, duplicate files, and parser timeout/crash.
- [ ] Start with at most 5 materials/course, 25 MiB/PDF, 1 MiB/text file, 50 MiB/course, 200 selected PDF pages/course, and 1 MiB extracted UTF-8/course. Offer page-range selection or a clear smaller-file message when limits are exceeded; never silently truncate an entire book.
- [ ] Copy selected files into a private local material store with generated IDs/hashes. Parse PDF.js in a separate terminable sandboxed document host without the app bridge, remote navigation/network, or executable PDF actions; use bounded plain-text/Markdown parsing for notes. Enforce host timeout/output caps and process sequential pages to bound memory.
- [ ] Extract text, available outline/page labels, formulas as available text, and stable page/section offsets. Record unreadable pages explicitly. If all content is unreadable, block course generation and suggest a text-searchable PDF/TXT; no OCR claim.
- [ ] Render relevant original PDF page snapshots or clipped regions locally for figure/example reuse, with page labels and captions. Figures remain source evidence; do not claim the model understood raster-only details from extracted text. Formula/layout uncertainty stays visible. PDF.js supports local page access/rendering; see [official examples](https://mozilla.github.io/pdf.js/examples/).
- [ ] Use bounded internal asset IDs, no document HTML injection or arbitrary local paths. Cancelled imports clean staged files; removing a material checks course/session references before cleanup. Restart preserves finished imports and marks interrupted jobs retryable.
- [ ] Run import tests plus IPC boundary tests; verify packaged PDF worker/assets load without network at final integration.

**Deliverable:** Inspectable local materials and honest extraction coverage. Depends on Task 2; can proceed alongside Tasks 3–5 after shared contracts are fixed.

## Task 7: Generate grounded courses and maintain source links

**Files:** create `main/documents/source-index.ts`, `main/ai/course-coordinator.ts`, `packages/teacher/src/course-planner.ts`; extend repositories and source-aware teaching context. Tests: `tests/integration/document-course.test.ts`.

**Interfaces:** `TutorBridge.planCourse({documentIds}): Promise<CourseRecord>`, `loadCourse(courseId)`, `startCourseLesson({courseId, lessonId})`. `retrieveEvidence({documentIds, query, sourceRefs}, budgetBytes)` returns verified excerpts. Use local SQLite FTS5 when supported, with a deterministic bounded lexical fallback.

- [ ] Write failing tests proving outline concepts/examples come from extracted sections, every cited page/range exists, unreadable pages are excluded, and unsupported document claims produce a grounding warning rather than invented evidence.
- [ ] Generate bounded section summaries in batches through the same ChatGPT provider, then a coherent course outline (up to 30 lessons), preserving chapter coverage/objectives/formulas/examples and source references. Cache resumable batch results; retry cannot duplicate a course or charge through an endless loop.
- [ ] Preview the outline and extraction warnings before Start Teaching. Let the learner select the current lesson or a previous one. Reuse the topic playback pipeline with selected source excerpts and original page/figure views.
- [ ] Keep the total existing teacher context at 64 KiB: prioritize the entire accepted learner request, selected/current source excerpts, current concept, visible state, and heard conversation. Flag omitted evidence. Source text is untrusted content, never instructions granting tools or authority.
- [ ] Persist concept/course coverage and learner responses transactionally. Allow clearly labeled extra explanation beyond the material without inventing citations. Reimported/replaced sources invalidate affected references explicitly; deleting a lesson does not silently delete shared materials.
- [ ] Run course grounding/storage tests, including irrelevant retrieval, injected document instructions, invalid citations, network failure midway through planning, and restart after partial teaching.

**Deliverable:** A document-based visual course, not only a document summary. Depends on Tasks 3, 4, and 6; uses Task 5 visuals.

## Task 8: Integrate the immersive UI and improve companion delivery

**Files:** create renderer `learning/Roadmap.tsx`, `learning/LearningWorkspace.tsx`, `learning/PlaybackControls.tsx`, `materials/MaterialImport.tsx`, `materials/SourcePreview.tsx`; integrate `App.tsx`, `styles.css`, teacher instructions, voice preferences, `DESIGN.md`, and `UX-CONTRACT.md`. Tests: renderer `learning/LearningWorkspace.test.tsx` and existing `App.test.tsx`.

**Interfaces:** UI consumes the earlier bridge methods, plan/course records, and playback controller. Playback/controller state remains authoritative; UI components do not invent completion or generation progress.

- [ ] Test topic → roadmap → Start Teaching and Upload Study Material → coverage/outline preview → start lesson, including unconnected account and unavailable-model recovery.
- [ ] Implement the proposed layout, compact progress, current concept, source references, persistent question/adjustment controls, and collapsible transcript/roadmap. Preserve existing responsive widths, native dialog focus, keyboard alternatives, and reduced motion.
- [ ] Improve local Kokoro delivery with concise spoken sentences, punctuation-based pauses, bounded local speed preference, and one-chunk prefetch; retain the existing female voice and local fallback. Do not promise emotional voice control or forced alignment the engine does not expose.
- [ ] Keep confusion responses genuinely different, use purposeful understanding checks, and preserve relevant explicit learner preferences/course evidence locally. Do not infer mastery from listening or silently construct a broad personal profile.
- [ ] Test mic denial, typed fallback, interrupted synthesis, speaker gating/headphones, navigation/close saves, unreadable-source notices, keyboard-only controls, and narrow layouts. Perform a real microphone trial on the available machine after approval and report if physical input cannot be exercised.
- [ ] Run renderer/voice tests and typecheck/lint. Update design/UX contracts to match the implemented behavior.

**Deliverable:** One coherent, visuals-first teaching experience with practical local voice improvements. Depends on Tasks 3–7.

## Task 9: Validate the complete experience and package Windows builds

**Files:** new `tests/e2e/visual-lesson.spec.ts`, `document-course.spec.ts`, `playback-recovery.spec.ts`; extend current E2E/regression tests and `scripts/eval-live.mjs`; write `docs/canvas-atlas-visual-companion-validation.md` and update README.

- [ ] Test gravitation end to end: dynamically generated roadmap; two-body attraction; Newton's equation/units; doubling distance produces one-quarter force in a checked example; changing mass; orbit illustration with assumptions; understanding check; follow-up and simpler explanation; save/reopen.
- [ ] Test a math construction, a biology process, and an algorithm/data structure to ensure the visual vocabulary is topic-appropriate. Use deterministic fixtures for orchestration and arithmetic; separately inspect live teaching for factual/visual quality.
- [ ] Test a synthetic multi-section PDF course with a formula/example/figure and an unreadable page: outline preview, grounded lesson, real page reference, pause/replay, interruption, restart, and retained progress. Repeat failure cases for audio, visuals, import, network, and disk writes; none may falsely complete a lesson.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm test -- --maxWorkers=2`, `npm run build`, and ordinary `npm run test:e2e`; require all mandatory checks to pass. Run existing sandbox isolation/replay/save and old-session regressions as part of the suite.
- [ ] Perform a bounded live selected-account planning/teaching trial and local Kokoro/microphone checks, respecting account limits. Record latency, synchronization behavior, grounding quality, and observed limitations without exposing tokens or private material.
- [ ] Build an unpacked Windows app and NSIS installer with `--publish never`; test packaged local document assets, voice, playback recovery, and simulation boundary. Do not install over the user's current app or publish externally as part of this plan.
- [ ] Deliver a concise change/file/test report, verified build locations, and limitations. Identify untested hardware or teaching domains explicitly; do not equate sandbox safety with scientific validation.

**Deliverable:** A tested Windows upgrade and evidence-based validation report. Depends on all preceding tasks.

## Approval and execution boundary

The user approved this complete plan on 23 October 2026. Execution uses sequential shared-contract/integration work with parallel bounded visual and document modules, plus independent review before packaging. The nine tasks are delivery order, not nine separate approval stops.

Approval includes the stated initial document formats, local-only extraction without OCR, existing local female voice, and a limited trusted 3D renderer. Any change requiring a new external AI service or API key would need a revised proposal.
