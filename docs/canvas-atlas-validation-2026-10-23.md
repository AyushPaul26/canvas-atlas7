# Canvas Atlas reliability update — 23 October 2026

This update implements all seven confirmed defects from the codebase analysis and renames the product to Canvas Atlas. The analysis remains a historical record against commit `014d175`.

## Implemented

- Reset/start/clear discard obsolete queued control values, so settling and saving complete after old work resolves.
- Model selection pauses and checkpoints before changing models. Global cancellation produces explicit paused epochs and stops renderer presentation; stale progress errors cannot reappear after cancellation.
- Every accepted short speech onset resolves after silence, including 44.1 kHz / 4,096-sample callbacks between the former onset/final thresholds.
- Live execution and replay consistently call `globalThis.simulation`, including when source declares a shadowing lexical variable.
- Disposable preflight exercises initialization, one fixed step, and a default input, while preserving the original preview and current live runtimes.
- Live requests omit redundant state. Source, state, replay log, and scene have individually bounded and compatible aggregate checkpoint/request/save envelopes. Input history is checked before a control is dispatched.
- Accepted topics/questions consistently allow 6,000 characters. Current-request context preserves the complete text, including final instructions and multibyte content.
- UI, titles, teacher identity, sign-in copy, export captions/filenames, product metadata, executable, and launcher use Canvas Atlas. The canvas itself is labelled Lesson canvas.

## Data compatibility

The stable application ID remains `org.livingcanvas.desktop`. Existing `living-canvas` or `Living Canvas` user-data directories are reused in place, retaining SQLite lessons, encrypted credentials, preferences, and installed voice models. Fresh installations use `canvas-atlas`. Explicit test/deployment data directories remain supported.

Internal package namespaces, preload bridge, session partitions, and lesson export format remain compatible. No user credential contents were inspected or copied. No live account inference, new model download, or publishing was performed.

## Regression evidence and review

Implementers observed failing regression tests before fixing each defect. The full source suite then passed 149 tests. Independent review found an additional composition edge in the aggregate fix: valid wide/deep guest states could exceed a reused complexity allowance solely because of save/request wrappers. Two actual-runtime → IPC → persistence → replay regressions failed before correction and pass afterwards. Aggregate node/depth budgets now compose while original per-field limits remain enforced.

The independent review also found two remaining old-name labels. They were corrected. The scoped follow-up review found no remaining P1/P2 findings in the patch.

## Settled checks

- TypeScript: passed.
- ESLint: passed.
- Production Electron/Vite build: passed, including worker and WASM assets.
- Final Vitest suite after review fixes: **151 passed, one optional test skipped, across 29 files**.
- Final rebuilt-app Electron end-to-end: **three passed, two opt-in device/network trials skipped**. Covers normal OS close, offline persistence and branding, isolation/recovery, lexical-shadowed replay, missing-method preflight, and large-state durable save/replay.
- Packaged executable: the generated-simulation isolation/recovery/save/replay check passed against `release/win-unpacked/Canvas Atlas.exe`.

One desktop close test timed out during a run concurrent with heavy packaging. After packaging completed, the unchanged full desktop suite passed in 12.1 seconds; the close test passed in 4.6 seconds. No timeout was increased and no product change was made to conceal that transient failure.

Sandboxed test failures in the earlier review were environmental; final Vitest execution used a workspace-local temporary directory outside the sandbox for mock OAuth loopback callbacks and file operations. Tests use synthetic provider responses, not live teaching.

## Windows artifacts

Electron Builder completed with exit 0 using the already installed Electron runtime and cached Windows builder tools. Its initial default sandboxed download lookup could not resolve GitHub; the final package used local inputs, outside the sandbox, and `--publish never`.

- Executable: `release/win-unpacked/Canvas Atlas.exe`.
- Installer: `release/Canvas Atlas Setup 0.1.0.exe`, 128,039,799 bytes (about 122 MiB).
- Windows executable product name and description both read Canvas Atlas; version remains 0.1.0. The package is unsigned, as the earlier local development build was.
- Packaged application metadata uses `canvas-atlas` and the correct bundled main entry.
- Launcher: `Launch Canvas Atlas.cmd`.
- The existing Start Menu entry was replaced with Canvas Atlas, targeting the verified executable in this workspace. The old shortcut was backed up in `.test-tmp` before replacement.

No installer was run and nothing was published. The verified directory package is directly runnable.

## Remaining acceptance limits

Physical microphone/echo behavior, live teaching quality across subjects, scientific correctness of generated experiments, and cross-lesson personalization remain separate work. This patch does not represent those unfinished capabilities as completed. Existing lucide-react bundler advisories remain non-failing.
