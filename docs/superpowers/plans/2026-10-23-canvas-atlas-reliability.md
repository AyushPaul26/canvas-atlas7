# Canvas Atlas reliability and rename implementation plan

> **For agentic workers:** Apply the regression-first workflow to each task; independent file ownership permits parallel implementation. Keep implementation in the current development checkout.

**Goal:** Fix the seven confirmed defects in the 23 October codebase analysis and rename the application to Canvas Atlas.

**Architecture:** Preserve the current Electron/React/QuickJS/SQLite architecture. Correct cancellation and queue ownership, exercise disposable simulation preflight, align complete serialized budgets, preserve accepted learner requests, and change product branding without losing existing local data.

**Tech stack:** Electron, React, TypeScript, Vitest, Playwright, QuickJS, SQLite, local Whisper/Kokoro.

**Spec:** `docs/codebase-analysis-2026-10-23.md`, confirmed findings 1–7, plus the user's explicit Canvas Atlas rename request.

## Global constraints

- Product display name and executable: Canvas Atlas.
- Keep account credentials, lessons, session partitions, internal preload bridge, export format, and application identity compatible with existing installations. Do not inspect credential contents.
- No live account inference, model downloads, dependency upgrades, or publishing.
- Preserve existing process isolation, execution/geometry limits, and deterministic replay semantics.
- Use the existing 6,000-character UI limit consistently for topics and questions, and preserve every accepted character in current-request model context.
- Source/output/scene budgets remain bounded. Introduce explicit bounded aggregate checkpoint/request/save budgets rather than relaxing all limits indiscriminately.
- Observe failing regression tests before implementing each defect's fix. Run the integrated suite after edits and perform an independent final review.
- Do not commit, push, merge, or change user shortcuts outside the workspace without need. Deliver the source changes and a refreshed Windows package/installer if packaging works locally.

## Review focus

- Reset after multiple control changes with the first input unresolved must not strand Save/navigation.
- Model changes during inference or presentation must flush/cancel cleanly and leave a terminal UI state.
- Speech between the onset and old finalization thresholds must end at the silence deadline at real callback sizes.
- A generated program that works live must use identical API lookup during replay, including lexical shadowing.
- Maximum state/source/history combinations must remain transferable and saveable; rejected inputs must not be silently applied without replay provenance.

## Task 1: Simulation runtime correctness

Ownership: `packages/simulation/src/index.ts`, `tests/unit/simulation.test.ts`.

- [x] Add failing regressions for lexical `simulation` shadowing during replay, missing/throwing step/input during preflight, and successful preflight retaining the original initialization preview and live runtimes.
- [x] Use `globalThis.simulation` consistently during replay. Exercise one bounded step and default input in the disposable preflight; retain the initial preview result.
- [x] Run focused runtime tests and record results.

## Task 2: Renderer queue and brief speech

Ownership: `apps/desktop/src/renderer/useSimulation.ts`, `localSpeech.ts`, and their existing test files.

- [x] Add failing reset-with-queued-controls and real-size short-speech regressions.
- [x] Clear/scope pending control values when runtime generations change. Settle must complete after reset/clear when old work finishes.
- [x] Stop retransmitting unused simulation state on live requests. Reject an input before dispatch if its complete proposed replay history exceeds `LIMITS.inputHistoryBytes` (1 MiB), and restore the committed control value on rejection.
- [x] Finalize accepted brief speech after silence; retain transient-click rejection and cancellation behavior.
- [x] Run the focused renderer tests and record results.

## Task 3: Model transitions and complete current requests

Ownership: coordinator, teacher package, App model handler, and related coordinator/teacher/App tests. Main branding edits follow after this task returns.

- [x] Add failing regressions for model switch during inference/presentation and a 4,001–6,000-character question with essential instructions at its end.
- [x] Await pause/checkpoint before the UI changes models. Make global cancellation explicitly transition active sessions to paused without allowing stale acknowledgements.
- [x] Preserve the entire current accepted request in context; bound/reject input above 6,000 characters explicitly. Trim older context before the current request.
- [x] Run focused teacher/coordinator/renderer tests and record results.

## Task 4: Aggregate boundaries, compatible rename, integration

Root ownership: protocol, IPC, sandbox service, app bootstrap/identity, packaging/lockfile, remaining visible branding, e2e tests, launch scripts, current README and validation documentation.

- [x] Add failing boundary/identity regressions. Define `learnerRequestChars=6000`, `inputHistoryBytes=1 MiB`, `checkpointBytes=4 MiB`, `simulationRequestBytes=checkpointBytes+sourceBytes+64 KiB`, and `saveBytes=checkpointBytes+sceneBytes+64 KiB`.
- [x] Validate complete UTF-8 checkpoint/history/request/save envelopes. Preserve 2 MiB individual scene/output limits and per-field limits. Exercise a large accepted state through live stepping, durable save, and replay.
- [x] Align topic/question IPC limits and input behavior with the accepted 6,000-character contract.
- [x] Rename visible UI, HTML/window titles, teacher identity, OAuth copy, export captions, product metadata, executable/installer/launcher, and current documentation. Retain stable compatibility identifiers and reuse existing user-data directories.
- [x] Run typecheck, lint, full Vitest suite, production build, actual Electron e2e, and local packaging. Re-run relevant checks after any review fixes.
- [x] Obtain an independent read-only review of the complete patch; address substantive findings and record final verification.

## Progress and decisions

- Baseline: commit `014d175`; existing analysis report is the only untracked file. Previous turn verified 120 passing tests, one skip, three passing offline Electron e2e tests, typecheck/lint/build.
- Decision: reuse the existing `build/living-canvas` development checkout; no additional checkout or dependency installation is needed.
- Decision: preserve internal `@living-canvas` package namespaces, preload `livingCanvas`, export format, and stable application ID for compatibility. User-facing branding and root product metadata become Canvas Atlas.

- Complete: Tasks 1–4; each defect's regression failed before its implementation and passed afterwards. Final suite: 151 passed, one optional skip. Typecheck/lint/build passed. Three ordinary Electron checks and the packaged-executable simulation/save/replay check passed.
- Review: one aggregate complexity issue and two missed labels were corrected in a single fix wave. Scoped follow-up review was clean.
- Packaging: reused installed Electron and cached tools after sandboxed download lookup failed. Local installer and runnable directory were produced with no publication. Start Menu entry now targets Canvas Atlas in this workspace.
