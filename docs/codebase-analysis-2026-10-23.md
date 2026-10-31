# Living Canvas codebase analysis

Reviewed 23 October 2026 against commit `014d175` (`feat: add local female voice and continuous tutor conversations`).

Living Canvas has an implemented desktop teaching loop, clear process boundaries, and meaningful automated coverage. The main engineering weakness is coordination between independently asynchronous teaching, audio, simulation, and persistence state. Seven reproducible P2 reliability defects were found. No P1 defect was confirmed in this review.

This assessment supports continued development and controlled user trials. It does not establish general teaching quality, scientific accuracy, or production readiness for a broad release.

## Scope and method

Reviewed the authored product under `living-canvas`: Electron main/preload, React renderer and canvas, protocol, teacher, scene, simulation, voice packages, simulation host, local voice worker, storage, authentication, build configuration, scripts, and related tests and implementation records. Three independent reviewers covered teaching, renderer/voice, and simulation; the coordinating review covered composition, IPC, authentication, storage, packaging, and verification.

The source inventory contains approximately 48 source/script/style/HTML files with 3,109 physical lines, plus 33 test files with 1,709 lines, excluding root configuration and external dependencies. Many files compress substantial logic onto single lines, so line counts understate complexity.

The adjacent Graphify checkout is development tooling, outside the product runtime. Its integration script was reviewed; its independent third-party codebase, installed dependencies, native binaries, model weights, private user data, and existing credentials were excluded. No live account inference, account sign-in, model download, or physical microphone capture was performed.

Application source was not changed. This report was added; generated build/test artifacts were refreshed.

## Fresh verification

| Check | Observed result |
| --- | --- |
| TypeScript, `tsc --noEmit` | Passed, exit 0 |
| ESLint over the project | Passed, exit 0 |
| Production Electron/Vite build | Passed, exit 0; main, both preloads, renderer, simulation worker, and WASM emitted |
| Vitest, two workers | 120 passed, one optional test skipped; 26 passing files and one skipped file |
| Electron Playwright tests | Three passed: shell/offline persistence, normal-close checkpoint, simulation isolation/recovery |
| Optional end-to-end trials | Installed neural voice and public-network sign-in trials skipped |
| Targeted offline probes | Confirmed queued-control/reset save hang, replay name-resolution mismatch, insufficient preflight, oversized next-request envelope, request truncation, brief-speech stall, and backend cancellation status behavior |

Initial sandboxed test runs encountered temp-file rename restrictions, blocked mock OAuth loopback requests, and worker startup timeouts. A workspace-local temp directory removed the rename failure. Running the suite outside the sandbox resolved the remaining environment failures and produced the passing result above. The default unconstrained test concurrency was not separately established as reliable in this environment.

The direct commands used for settled checks were:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/electron-vite/bin/electron-vite.js build --config apps/desktop/electron.vite.config.ts
$env:TEMP = Join-Path $PWD '.test-tmp'
$env:TMP = $env:TEMP
node node_modules/vitest/vitest.mjs run --maxWorkers=2
node node_modules/@playwright/test/cli.js test
```

The build still emits lucide-react module-directive and bundler timing advisories. They did not fail the build. Installer creation, signing, dependency vulnerability status, and the previously packaged executable were not revalidated in this review.

## Architecture and teaching flow

| Area | Responsibility | Assessment |
| --- | --- | --- |
| Electron composition and IPC | Connect account, database, tutor, speech, sandbox, and window | Explicit bridge with sender/frame checks and bounded inputs; limited renderer authority |
| Account/provider | Browser OAuth, protected credentials, refresh, model catalog, completed response stream | PKCE/state/nonce/JWT checks, serialized refresh, exact model preservation, separate served-model evidence |
| Lesson coordinator | Accept questions, prepare beats, repair failures, interrupt, continue | Epoch and semantic-revision checks are substantive; global cancellation does not consistently finish renderer state |
| Protocol/teacher | Validate generated teaching data and assemble bounded context | Strong geometry/control/tool validation; current-request truncation loses accepted input |
| React/canvas | Present queued beats, editable scene, selections, notes, progress | Real visible/heard acknowledgements; too much lifecycle ownership concentrated in App |
| Simulation boundary | Execute generated source and restore saved computation | QuickJS inside a worker inside a separate sandboxed renderer; replay and message-envelope defects remain |
| Local voice | Capture, VAD, rolling recognition, narration, echo gating | Bounded queues and cancelable native inference; short-utterance edge case and hardware acceptance remain |
| SQLite | Sessions, events, scene revisions, preferences, replay provenance | Transactional local durability; increasingly expensive full snapshots and history scans as data grows |

The actual lesson path is:

1. The renderer creates or opens a local session and submits a question through the typed preload.
2. Main validates account/model state and dispatches to the coordinator.
3. The coordinator loads acknowledged lesson context and recent provider history, captures the selected model, and requests namespaced teaching tools.
4. Completed response data is parsed and validated. Proposed experiments run a disposable initialization preflight. Accepted beats are recorded as prepared work and emitted to the renderer.
5. The renderer queues drawing and narration. Actual visible scene and completed narration prefixes are acknowledged back to main and persisted.
6. Fully acknowledged `next: continue` work grants a one-shot continuation permit. Continuation retains selection focus and does not fabricate a learner message. Automatic rounds are bounded.
7. Edits, interruption, navigation, export, and normal close attempt to settle simulation work and save the current presentation/checkpoint.

This distinction between prepared output and observed presentation is one of the strongest choices in the implementation. Authentication data stays in main; generated source stays inside the simulation boundary; preview mode does not invent tutor answers.

## Confirmed defects

All seven findings are P2: real issues that should be corrected in the normal development cycle. The ordering reflects user impact and likely frequency rather than a claim that every case occurs in ordinary short lessons.

### 1. Reset with queued controls can leave saving and navigation waiting indefinitely

Source: [useSimulation.ts:47](<C:/Users/Ayush Paul/Desktop/23rd aanna/learner guide/living-canvas/apps/desktop/src/renderer/useSimulation.ts:47>), especially lines 47–58, 67–86; [App.tsx:205](<C:/Users/Ayush Paul/Desktop/23rd aanna/learner guide/living-canvas/apps/desktop/src/renderer/App.tsx:205>).

Trigger: change a simulation control while an input call is pending, queue another control value, then reset before the first input resolves. `start()` replaces the runtime/epoch but leaves `pendingValues` populated. The old updater detects its stale epoch and returns without consuming those values. `settle()` waits while either an invocation or pending values exist, so Save, export, pause/navigation can remain unresolved. Normal close eventually reaches its forced-close timeout.

An in-memory execution of the actual hook produced `calls=["init","input","init"]` and `settledAfterReset=false` after the replacement runtime initialized. Clearing the hook released the wait. No unresolved provider or guest execution was necessary.

Suggested correction: clear or explicitly cancel queued input when replacing a runtime, associate pending input with its epoch, and give settling a well-defined cancellation/failure outcome. Add a regression for two control changes followed by reset during a deferred input call.

### 2. Model changes do not cleanly terminate the active lesson presentation

Source: [ipc-router.ts:52](<C:/Users/Ayush Paul/Desktop/23rd aanna/learner guide/living-canvas/apps/desktop/src/main/ipc-router.ts:52>), [lesson-coordinator.ts:18](<C:/Users/Ayush Paul/Desktop/23rd aanna/learner guide/living-canvas/apps/desktop/src/main/ai/lesson-coordinator.ts:18>), [App.tsx:136](<C:/Users/Ayush Paul/Desktop/23rd aanna/learner guide/living-canvas/apps/desktop/src/renderer/App.tsx:136>), and the Settings model handler at line 374.

Trigger: submit a question, open Settings while the provider is pending, and select another model. The selector remains enabled during teaching. `setModel()` invokes `cancelAll()`, which invalidates backend work and presentation acknowledgements without emitting a terminal lesson status. The renderer only updates account/model status, leaving its phase at `thinking`.

During an existing presentation, old audio/drawing can continue while progress acknowledgements fail as stale. An offline coordinator probe emitted only the initial `thinking` event after send, global cancellation, and provider abort.

Suggested correction: await the existing pause/checkpoint flow before changing models and make global cancellation produce an explicit renderer transition. Cover model switching during pending inference and during queued narration.

### 3. Brief accepted speech can stay active until the 28-second cutoff

Source: [localSpeech.ts:58](<C:/Users/Ayush Paul/Desktop/23rd aanna/learner guide/living-canvas/apps/desktop/src/renderer/localSpeech.ts:58>), especially lines 58–68 and 82.

Speech onset is accepted at 180 ms. Silence finalization requires at least 240 ms of voiced audio. A detected utterance between those thresholds is neither finalized nor discarded; partial recognition additionally requires 300 ms. It can therefore remain in the listening state until the 28-second sample cap.

Reproduction used 44.1 kHz audio and 4,096-sample callbacks: two voiced callbacks supplied 185.76 ms of speech. After another 9.29 seconds of silence, the pipeline still reported active speech, with zero recognition jobs and zero final results. This models short answers such as a quick “yes,” as well as some noise onsets; no physical-device claim is implied.

Suggested correction: resolve every accepted utterance at the silence deadline, with an explicit discard path for insufficient speech or compatible onset/final thresholds. Add coverage using actual capture callback sizes.

### 4. Replay uses different name resolution from live simulation execution

Source: [simulation/index.ts:115](<C:/Users/Ayush Paul/Desktop/23rd aanna/learner guide/living-canvas/packages/simulation/src/index.ts:115>).

Live initialization, step, input, and render call `globalThis.simulation`. Replay calls bare `simulation`. A generated program can declare a top-level lexical variable with that name while exporting its public API on `globalThis.simulation`:

```javascript
const simulation = {};
globalThis.simulation = {
  init() { return { x: 0 }; },
  step(s) { return { x: s.x + 1 }; },
  input(s) { return s; },
  render(s) {
    return { entities: [{ id: 'p', kind: 'text', x: s.x, y: 0 }] };
  }
};
```

The actual runtime initialized and advanced this program to `x=1`; replaying tick 1 failed. A working saved experiment can consequently require reset because replay resolves a different object.

Suggested correction: consistently use `globalThis.simulation` in replay and add a lexical-shadowing replay regression.

### 5. Preflight accepts experiments that fail on their first step or input

Source: [simulation/index.ts:123](<C:/Users/Ayush Paul/Desktop/23rd aanna/learner guide/living-canvas/packages/simulation/src/index.ts:123>) and [app.ts:34](<C:/Users/Ayush Paul/Desktop/23rd aanna/learner guide/living-canvas/apps/desktop/src/main/app.ts:34>).

Preflight evaluates source, initialization, and the initial render. It never verifies or exercises `step` or `input`. A program exporting only successful `init` and `render` methods passes preflight and live initialization, then fails immediately on playback. Explicitly throwing step/input methods pass the same check.

The actual runtime reproduced successful preflight followed by a failed first step. Since main treats successful initialization as acceptance, the existing bounded model-repair flow never receives this failure before the experiment is presented.

Suggested correction: verify the synchronous API and exercise a bounded step and default-value input in the disposable runtime. Add coordinator coverage showing these diagnostics reach the repair loop. This still would not prove scientific correctness.

### 6. Accepted simulation output can exceed the following request/checkpoint limit

Source: [useSimulation.ts:27](<C:/Users/Ayush Paul/Desktop/23rd aanna/learner guide/living-canvas/apps/desktop/src/renderer/useSimulation.ts:27>), [sandbox-window.ts:97](<C:/Users/Ayush Paul/Desktop/23rd aanna/learner guide/living-canvas/apps/desktop/src/main/sandbox/sandbox-window.ts:97>), and [ipc-router.ts:58](<C:/Users/Ayush Paul/Desktop/23rd aanna/learner guide/living-canvas/apps/desktop/src/main/ipc-router.ts:58>).

The runtime permits output close to 2 MiB independently of source size. The renderer resends both full source/artifact and returned state on every call, although the worker already retains them. The complete next request and save checkpoint are each limited to 2 MiB.

A 250,138-byte source returning a state string of 1,900,000 characters initialized successfully. The next serialized step request occupied 2,150,358 bytes, above the 2,097,152-byte envelope. A program can thus pass preflight/init and still be impossible to advance or save. Restore additionally includes input history in this envelope.

Suggested correction: use compact run/action/control requests after initialization and budget the complete durable checkpoint, including source, state, scene, and input history. Add aggregate-limit coverage rather than testing individual field limits alone.

### 7. Accepted long questions silently lose their final instructions

Source: [teacher/index.ts:61](<C:/Users/Ayush Paul/Desktop/23rd aanna/learner guide/living-canvas/packages/teacher/src/index.ts:61>), related line 88; [ipc-router.ts:14](<C:/Users/Ayush Paul/Desktop/23rd aanna/learner guide/living-canvas/apps/desktop/src/main/ipc-router.ts:14>).

The question UI accepts up to 6,000 characters and IPC permits 16,000. Context construction sends only the first 4,000 characters of the current request. Recent conversation entries retain only their first 1,000, so the omitted suffix is not restored by message history. The truncation flag is internal; the learner receives no indication that their actual question may be missing.

An actual context-builder probe accepted a 4,136-character request but forwarded 4,000 characters. A question placed at the end was absent from the entire serialized context. Pasted material followed by instructions is a practical trigger.

Suggested correction: reserve capacity for the complete current question before trimming older conversation/scene context, or consistently enforce a visible input limit. Also align the initial-topic UI's 6,000-character limit with session creation's 4,000-character limit.

## Capabilities and limits

**Implemented:** real account-backed generation; exact model selection and run metadata; dynamic teaching tools; queued explanations/drawings; bounded automatic continuation; pointing/selection context; editable semantic 2D entities and notes; generated adjustable experiments; local speech adapters; local session persistence, export/delete, and deterministic replay provenance.

**Personalization currently means current-lesson adaptation.** The context uses selected objects, visible scene, controls, assumptions, and up to 14 bounded conversation entries. Provider history retains up to four bounded output/feedback rounds. The database creates a `learner_evidence` table but no implementation reads/writes it. There is no cross-lesson learner profile, mastery model, or retrieval of evidence from prior lessons. Existing ChatGPT conversations/memory are not imported.

**Voice is local but not yet validated as a natural conversational system.** Recognition reloads Whisper and verifies its files per request, making rolling transcription CPU/disk sensitive. Existing packaged measurements record recognition near 4.5 seconds in one trial. Narration words follow duration estimates rather than forced alignment; persistence intentionally commits completed chunks. Speaker mode suspends recognition during playback, while headphone mode permits interruption without acoustic echo cancellation.

**Experiment safety and scientific validity remain separate.** Isolation, resource bounds, and deterministic test-program replay are implemented. There is no general mechanism that establishes correctness of arbitrary generated equations, assumptions, numerical models, or learning outcomes. Generated evidence status is appropriately forced to illustrative.

**Other unfinished areas:** physical microphone/accent/noise/echo acceptance, freehand sketch interpretation, 3D, and broad teaching-quality evaluation. `eval:live` is setup guidance that exits with code 2; it is not an automated live teaching benchmark.

## Maintenance and coverage observations

- `App.tsx` owns navigation, asynchronous operations, presentation, progress, saving, microphone submission, controls, account settings, and substantial JSX. Extracting cohesive lifecycle controllers would make the transition rules easier to inspect and test. Formatting the dense one-line logic would improve reviewability without a framework rewrite.
- `SceneStore` has revision and namespace tests, but the live renderer uses its own `applyBeat`/React state logic. Passing SceneStore unit tests therefore does not directly prove live renderer merge behavior. Consolidate the applicable scene invariants or explicitly test both paths.
- Session listing loads/parses every full lesson snapshot. `providerHistory()` loads/parses all session events before taking the last four provider rounds. Persistence repeatedly rewrites snapshots containing accumulated messages/beats/source. These are structural scaling concerns; no large-library performance failure was measured here. Query narrow metadata and recent events directly before a large pilot.
- Guest errors are collapsed to one generic execution/budget message, so the model repair loop cannot distinguish many reference/type errors from actual timeouts. Preserve bounded, sanitized diagnostics from the isolated guest.
- A mixed response containing valid and invalid teaching calls publishes the valid call and returns without repairing the invalid one in that request. This was verified as current partial-acceptance behavior; no separate user-facing defect was established. Decide and test the intended policy.
- `program_versions`, `playback_checkpoints`, and `learner_evidence` are declared but unused. Build aliases also retain a nonexistent `timeline` package. These reflect earlier planning rather than implemented capabilities.
- Existing sandbox tests meaningfully exercise absent host capabilities, denied networking, runaway interruption, and recovery. They do not independently force the outer worker watchdog path, heap/stack exhaustion, renderer/boot crashes, all replay boundaries, or aggregate message limits.
- Renderer and voice tests frequently mock adjacent components. Add transition tests spanning those boundaries: queued input → reset → save, model switch → canceled inference/presentation, short speech → silence → finalization, and live execution → durable save → replay.

## Suggested work order

1. Correct reset/settle and model-switch cancellation first. They affect the learner's ability to save, navigate, and trust the visible status.
2. Fix short-utterance finalization, then measure actual microphone-to-final-text and audible stop latency on the target Windows device.
3. Make replay API lookup consistent, strengthen disposable preflight, and align complete simulation/checkpoint envelopes.
4. Preserve the complete current question and make input limits consistent across UI, IPC, and context.
5. Add a small multi-topic teaching evaluation using saved transcripts, acknowledged visuals, follow-up answers, and experiment checks. Measure specific outcomes such as misconception correction and appropriate questioning.
6. Add cross-lesson personalization from explicit learner evidence, with provenance and controls to inspect/correct it. Keep observed learner statements separate from inferred understanding.
7. Refactor the lifecycle ownership and optimize storage queries as the evaluation workload grows. Keep the existing process isolation and validated tool architecture.

The immediate work is concentrated reliability correction and acceptance testing. The implemented architecture provides a useful base for that work; a wholesale rewrite is not supported by the evidence from this review.
