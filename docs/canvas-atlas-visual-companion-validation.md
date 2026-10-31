# Canvas Atlas visual companion — 23 October 2026

This upgrade implements the user-approved visual learning companion plan in the existing Electron/React application. Earlier rename and reliability fixes remain preserved. The checkout is intentionally uncommitted and no build has been published. The original visual-companion delivery was unpacked; the subsequent startup hotfix below is installed locally.

## Startup hotfix 0.1.1 — 23 October 2026

The user prioritized fixing opening from Windows Start before ElevenLabs. The old Start shortcut targeted `release/win-unpacked`, and the application did not handle repeated launches by restoring its existing window.

- Added queued second-instance activation: restore, show, and focus the existing window, including when the repeated launch arrives before window creation.
- The home screen can load while saved materials initialize. Material operations and source-backed teaching wait for readiness; ordinary topic teaching is independent. Closed windows cannot access the disposed database after deferred initialization.
- Added bounded, sanitized per-launch `startup.log` stage timings. Startup errors retain earlier stages and show an actionable diagnostic location.
- Installed version `0.1.1.0` into `C:\Users\Ayush Paul\AppData\Local\Programs\Canvas Atlas`. The actual per-user `Canvas Atlas.lnk` now targets that executable. The repository launcher prefers the same installed copy. Existing application/profile identity is retained.
- Verification: TypeScript and changed-file ESLint pass; **299 automated tests pass, 1 optional test skipped**. Four desktop tests pass for activation, offline sessions, saved-material import/restart, and normal-close checkpointing. The installed activation test also passes with early, minimized, and hidden relaunches.
- Actual Start shortcut verification: the first main window appeared in **940 ms** on this machine; a repeated launch restored and focused the same process; normal close and reopen passed. On reopening, renderer load completed **665 ms** after startup instrumentation began. These are observed timings, not a guarantee for every device.
- One initial installed instrumented run timed out waiting for a duplicate process to exit; a diagnostic rerun passed without weakening assertions/timeouts or changing product code. Its cause remains unclassified. Direct Start-menu acceptance passed independently. Initial sandbox-only loopback/temporary-file failures also passed in the normal desktop test environment.
- The installed and packaged `resources/app.asar` hashes match: `8894E4EB7651A493677D9A3BE8166887A450BFF8AE51B579716F0688A11126E9`.

Hotfix installer: `release/startup-fix/Canvas Atlas Setup 0.1.1.exe`. Detailed local evidence is in `.test-tmp/startup-fix/`, including the original and diagnostic installed test logs and `installed-startup-evidence.json`. ElevenLabs remains a separate proposed task.

## Implemented experience

- A topic generates a compact, topic-specific roadmap before **Start Teaching**. Concepts, prerequisites, checks, coverage, follow-up branches, and return points persist locally. Check responses retain answered/help-requested/skipped evidence; listening alone is never recorded as mastery.
- Accepted narration is divided into chunks. Actual local audio drives declarative reveals, highlights, motion, camera changes, and experiment controls. Pause/Resume, Replay, interruption, buffering, restart recovery, and failed-preparation Retry use separate audio, visual, and durable progress gates. Replay does not advance coverage or replace the acknowledged experiment.
- The canvas remains editable. Trusted Three.js primitives add bounded spatial explanations with a useful 2D fallback. Generated JavaScript remains confined to the existing QuickJS simulation boundary.
- PDF, UTF-8 TXT, and Markdown are imported through a native picker and processed locally. The PDF parser runs in a separate terminable host with bundled local assets. Readability warnings and actual original-page previews remain available. Course summaries, outlines, and teaching citations are restricted to immutable source ranges actually supplied for each request.
- The teaching workspace prioritizes the visualization, current concept, playback controls, and question input. Roadmap and transcript can collapse. The existing design, official account connection, model catalog, local Whisper, and local Kokoro female voice remain in place. Speaking speed is adjustable locally.

## Main implementation areas

| Area | Files |
|---|---|
| Contracts and durable state | `packages/protocol/src/{core,learning,playback,documents,visuals}.ts`; desktop storage repositories |
| Topic and course orchestration | `main/ai/{learning-plan-coordinator,course-coordinator,lesson-coordinator}.ts`; teacher planner, course planner, tool schemas, instructions |
| Sources | `main/documents/`; `apps/document-host/`; bundled PDF asset plugin |
| Presentation | Renderer `audioPlayback.ts`, `useLessonPlayback.ts`, `useVoice.ts`, `App.tsx`; scene timeline, canvas, visual adapters and 3D stage |
| Interface | Renderer `learning/`, `materials/`, styles; `DESIGN.md`, `UX-CONTRACT.md` |
| Validation | New unit/integration/domain tests, Electron journeys, live evaluation script |

## Verification

The final settled revision passed TypeScript, ESLint, and the production Electron/Vite build. Vitest passed **294 tests**, with **one optional test skipped**, across 52 files. The complete desktop suite passed **nine checks**, with three opt-in checks skipped, in **3.6 minutes**. The final packaged offline voice opt-in then passed separately. Physical microphone capture and fresh normal sign-in/live inference were exercised separately as described below. The ignored `.test-tmp/visual-companion/` ledger retains per-task reports and intermediate failures.

| Acceptance target | Final result |
|---|---|
| Normal close/save; renderer isolation and offline persistence | Passed against the production built main process |
| Native PDF formula/example/vector preview, cache regeneration, restart; QuickJS isolation/recovery | Passed against the final packaged executable |
| Roadmap gate; PCM pause/resume/replay; questions; failed audio; checkpoint restart; native WebGL/context loss and unavailable fallback; both-size pixel/occlusion checks | Passed with the final packaged renderer/preload loaded by the deterministic test main |
| Installed offline Kokoro/Whisper | Passed against the final packaged executable, with zero monitored provider-network attempts |

The fixture-driven cases use authored test content and silent PCM with the actual browser audio clock; they do not claim production model inference. Artifact hashes taken before the desktop run match the completed package. No source or packaged-code changes followed acceptance.

The independent reviews found and drove repairs for branch coverage/return, supplied-source enforcement, deep evidence retrieval, retained check evidence, branch experiment restoration, terminal visual/audio races, preparation Retry, restarted experiment cues, abandoned AudioContext startup, and saving during Replay. Live service validation also exposed unsupported JSON Schema `oneOf`; the strict schema now uses supported unions and homogeneous coordinate arrays, while local validation remains canonical.

Final screenshot/pixel checks also drove repairs for resize scale/origin, later-step fitting, toolbar clearance, and the completed-check layout. At 1050×760, the diagram has a 273 px stage with a 15 px equation and both masses unobscured; at 1440×940 the stage is 459 px. Native 3D and the explanatory fallback keep Pause and the question field reachable. The check/transcript rail scrolls separately from the reserved footer. Startup safely reclaims disposable page-preview PNGs in a bounded pass; imported originals and manifests remain intact.

Deterministic tests cover Newtonian force ratios, circular-orbit assumptions and arithmetic, a Pythagorean construction, enzyme conservation, and stable insertion sort using the real QuickJS runtime and staged visual contracts. These are authored test fixtures, not a claim that every generated lesson is correct.

Actual Electron journeys exercise production renderer/preload audio playback, roadmap gating, pause/resume/replay/questions, unavailable audio, and checkpoint close/reopen. The document journey uses a synthetic three-page PDF containing a formula, example, colored vector diagram, and unreadable page; it checks exact extracted text, real rendered preview pixels, and restart retention. Fixture-driven renderer journeys are distinguished from native production-main parser/simulation checks.

## Live account and local hardware evidence

The user completed a fresh normal ChatGPT sign-in in an isolated test profile. No browser encryption metadata was copied; automatic approval review rejected that attempted copy, and the trial proceeded through normal sign-in. The original profile and database were not opened or migrated by this upgrade task.

The live account generated a four-concept gravitation roadmap. A bounded teaching trial then requested and received **gpt-6-astra**, producing one accepted step with three narration chunks and eight visual cues in **38,154 ms**. It reused the generated roadmap after correcting the tool schema. Planning latency was not retained. The observed explanation correctly distinguishes equal and opposite forces and center-to-center distance for its two-sphere model. Prepared output was interrupted without acknowledging it as heard: **zero completed lesson beats** were recorded by that trial. Public generated content/model metadata remain only in ignored test artifacts.

Offline installed-model checks produced 24 kHz Kokoro female PCM, transcribed a freshly synthesized gravitation phrase with Whisper, and canceled synthesis. The first synthesis took **3,481 ms**, recognition **5,030 ms**, and a second synthesis **21,178 ms**; cancellation took **77 ms**. The checks observed zero network attempts. Real microphone capture received a nonzero signal at 48 kHz and released its tracks. This establishes local capture and engine operation; it does not establish human utterance recognition accuracy, echo handling, or conversational latency.

An initial packaged-engine check also passed: synthesis **3,586 / 6,774 ms**, recognition **3,723 ms**, cancellation **69 ms**, with zero monitored provider-network attempts. These measurements show variable latency rather than a guaranteed response time.

The final packaged artifact passed its offline engine check again: synthesis **880 / 1,176 ms**, recognition **2,254 ms**, cancellation **61 ms**, and zero monitored provider-network attempts. Its executable/archive hashes stayed unchanged through the check. This warm run does not erase the slower observations above.

## Limits

OCR, native DOCX/PPTX ingestion, arbitrary 3D assets, raster-only diagram understanding by the model, forced word alignment, and emotional voice control are outside this implementation. PDF formula/layout extraction can be imperfect and is shown as source uncertainty. Unsupported native speech fallback cannot pretend to buffer synchronized simulations; that path asks for the local Kokoro voice.

The trial was bounded to planning and the first generated teaching step. Whole lessons across subjects, real learner understanding, scientific validity of generated simulations, sustained microphone/echo performance, and natural conversation timing require continued evaluation. Local synthesis and model latency remain noticeable on this machine. Quantitative authored tests and sandbox isolation do not establish broad teaching quality.

## Windows artifacts

Electron Builder completed the final directory build and NSIS installer with `--publish never`. The output is separate because the earlier executable remains running; no application was closed or installed by this task.

- Launcher: `Launch Canvas Atlas.cmd` (prefers the upgraded directory below).
- Executable: `release/visual-companion/win-unpacked/Canvas Atlas.exe` — **246,820,352 bytes**, product name **Canvas Atlas**.
- Installer: `release/visual-companion/Canvas Atlas Setup 0.1.0.exe` — **148,278,537 bytes**, approximately **141.4 MiB**.
- Installer SHA-256: `1B0776BE59AA6FCA2A19C6CB78CAE97AB4D044E9A7C8E3E92FBC5832B443396F`.
- Packaged app archive SHA-256: `1F3E670CCBE6FDFE5A1F5ECBFC54C53BC9D9F0B06F6D9A62CFC1CD859B2B336B`.

The executable and installer are unsigned local development builds. Hashes confirm that the executable/archive under desktop acceptance match the completed package. Nothing was published. Save and close the earlier app before opening the upgraded launcher; both use the stable existing data-directory identity. The first launch backs up an existing v1 database before its additive v2 migration.
