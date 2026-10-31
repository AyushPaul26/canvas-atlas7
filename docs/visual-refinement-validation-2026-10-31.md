# Canvas Atlas 0.6.0 visual refinement

Implemented the user-approved refinement in the active Windows checkout without migrating the existing canvas or lesson coordinator.

## Learner-facing changes

- JSXGraph: paused graph exploration, point dragging, labelled keyboard coordinate fields, linked plots/vectors, equal-unit geometry and a Diagram return action.
- Matter.js: bounded 2D rigid-body models, joints, local numeric controls and measurements with explicit units.
- Three.js: bounded paused rotate/zoom, arrow-key and button controls, Reset view, escaped anchored labels and a text legend; teacher playback restores the accepted camera.
- Motion: brief supporting hint opacity transitions, disabled by reduced-motion preference. Meaningful lesson movement retains the existing audio clock.

The teacher can choose these capabilities through its existing present_beat tool. The single optional simulation engine field selects versioned bounded JSON or legacy QuickJS. JSON is capped at 64 KiB; local expression/depth/geometry/control limits apply before runtime admission. Libraries are bundled, with MIT notices under resources/licenses; JSXGraph uses its MIT option. No model-supplied callbacks, HTML, imports, plugins or network code enter the trusted engines.

## Persistence and review fixes

Manual edits during review now save their settled current model without rewriting historical presentation evidence. Save operations are serialized and reject superseded review snapshots. Reset and standalone playback use the same edit tracking; background autosave waits while a standalone experiment runs and explicit Save pauses it first. Lesson/course transitions clear old edit flags and restore the correct saved experiment, excluding stale simulation marks. Two-axis graph drags produce one input history entry. Rejected coordinate input restores the accepted value and permits retry.

## Verification

- Full Vitest run: **806 passed, 1 optional skipped**, 90 files (89 passed, 1 skipped). Log: .test-tmp/visual-refinement/unit.log.
- TypeScript and ESLint: exit 0. Production build and Windows NSIS packaging: exit 0.
- Frontend strict static audit, scoped to maintained renderer sources: **0 findings**. Artifact: .test-tmp/visual-refinement/premium-audit.json. Generated release copies are excluded by the audit configuration.
- Native source graph checks: actual SVG point dragging, atomic persisted input, keyboard edits, process restart replay, visible plotting height and narrow/reduced-motion scrolling; 2 tests passed including real Matter worker replay.
- Native Three checks: 2 tests passed, actual WebGL draws, pointer/keyboard exploration, exact camera reset/resume, unchanged checkpoints and visible compact-window controls. Native images were inspected; graph/3D flex clipping was corrected and regression assertions measure actual visible height.
- Existing native QuickJS boundary: passed, including runaway recovery, disposable preflight, replay, large saved state, separate hidden renderer and denied network/global bridges.
- Independent source review covered model admission, data/code boundaries, units, solver replay, renderer lifecycle and persistence. Reported save/reset/course issues were fixed with regressions.

Final packaged acceptance: **15/15 passed in 3.3 minutes** on the rebuilt artifact. Coverage includes Gemini/Groq teaching and courses, ElevenLabs settings/cancellation, learner safety, offline notes, ChatGPT/Gemini/Groq real local PDF creation/open/save/offline restart, PCM path timing/pause/resume/replay, the legacy QuickJS boundary, 3D pointer/keyboard/reset/reduced-motion/compact layout/width stability, startup activation, JSXGraph dragging/keyboard/save/restart and Matter replay. Log: .test-tmp/visual-refinement/packaged-final.log.

The tested NSIS installer completed with exit 0. Installed EXE and app.asar SHA-256 hashes match the tested unpacked build. The verified Start shortcut targets the installed executable and opened a visible Canvas Atlas window (PID 24424) after installation. No process was forcibly stopped. Evidence: .test-tmp/visual-refinement/installed-verification.json.

- Installer SHA-256: 121959CF536862C4BCC8FEE6E1288A580F8E10288F899B626C4F206CCD165C8B
- Installed/tested EXE SHA-256: E82B7E64239FED92A754D568229AC9885E0522C3E2D32D0EAAC81CA473871107
- Installed/tested ASAR SHA-256: 0528121C74231196B4F702B0E6AC67C639617D3FFA81EA3639742773060BB1B0
- Installed executable: C:/Users/Ayush Paul/AppData/Local/Programs/Canvas Atlas/Canvas Atlas.exe
- Installer: release/visual-refinement/Canvas Atlas Setup 0.6.0.exe

An initial packaged run passed 14 of 15 checks and exposed a remaining paused-layout feedback loop in the 3D workflow. Measured widths grew 1,147.25→1,361.46 px while the wrapper stayed fixed; its row flex basis was using the canvas's previous intrinsic width. Setting the diagram wrapper to flex-direction:column stabilized the spatial canvas at 1,126.4 px across the same sample sequence. The final installer is rebuilt after that correction; native coverage also checks width stability and real visible plotting height. No stability assertion was bypassed or timeout increased to hide the issue.

## Practical limits

Maths models are bounded numerical sampling and elementary expression operations, not symbolic algebra or general adaptive plotting. Undefined/out-of-range regions and detected discontinuities are omitted. Matter uses a fixed-step illustrative rigid-body solver with uniform gravity, not orbital gravity or independently verified scientific calculations. Replay remains capped at 36,000 ticks, 1,000 inputs, 1 MiB history and the existing one-second execution budget; expensive histories can require reset. Camera exploration is intentionally local display state. Existing saved QuickJS artifacts, notes, voice and teaching providers retain their prior paths.

Tests use synthetic teaching content and isolated local profiles. No paid/live AI inference or real-key probing was performed, so actual provider generation quality is not established by this validation. No commit, push or release publication was performed.
