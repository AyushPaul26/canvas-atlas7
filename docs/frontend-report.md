# Frontend implementation report

Implemented the English learning atelier in `apps/desktop/src/renderer`: Home → Start learning → exact topic question → tutor-led canvas workspace. Styling, bundled fonts, shared interaction behavior, and token ownership are documented in `DESIGN.md` and `UX-CONTRACT.md`.

The renderer uses the typed desktop bridge for account connection, models, sessions, exports, local voice, and isolated simulations. Browser preview is explicitly disclosed and never fabricates sign-in, lessons, or inference. Session lists contain stored data only. Settings refresh account/model state after model discovery. Deletion names the lesson, focuses Cancel initially, and refreshes history only after success.

The canvas renders generic Konva/RoughJS objects with KaTeX overlays; supports selection, dragging, keyboard movement, pan/zoom/Fit, accessible object selection, text/position editing, and learner annotations. Learner notes survive teacher board replacement. Simulation frames use bounded random per-run namespaces, remain separate from semantic edits, and can only be changed through controls. New experiments autoplay after successful initialization; restores and resets start paused. Saves preserve deterministic initial controls and tick-indexed applied inputs; failed control changes retain the last successful frame/control state.

Teaching beats present sequentially. Scene acknowledgements report the actual revealed marks, including the first frame of a new board. Narration acknowledgements extend only after completed spoken sentences or a reading dwell. Pause blocks late epochs immediately, cancels queued presentation, flushes actual progress before interrupting the teacher, and saves the simulation checkpoint even without manual edits. Completion checks generation/session/epoch again after asynchronous acknowledgement. Ordinary drawing/frame changes do not trigger learner-edit autosaves. Export always saves the current checkpoint first. OS close uses the main-process closing handshake to pause, flush progress, persist the latest experiment, and acknowledge closure exactly once.

## Verification

- Renderer Vitest: **28 passed**, 6 files. Covers disconnected topic entry, live request dispatch, event isolation, failed question retry, delayed-ack/pause race, new-board reveal ordering, sandbox initialization failure, replay records, frame namespace bounds/stability, failed input recovery, OS-close saving of an advancing clean experiment, export-before-checkpoint ordering, and mono16k PCM WAV encoding.
- `node node_modules/typescript/bin/tsc --noEmit`: exit 0.
- `node node_modules/eslint/bin/eslint.js apps/desktop/src/renderer`: exit 0.
- `node apps/desktop/src/renderer/verify-browser.mjs`: six workflow scenarios passed, no browser page errors. Tests use an explicit test-only in-memory desktop bridge. Browser preview remains inference-free. Evidence: `docs/frontend-evidence/browser-results.json` and desktop/narrow screenshots in that directory.
- Frontend Premium strict audit, using the scoped evidence manifest: **0 findings**. Report: `docs/frontend-audit.json`.
- `designmd lint DESIGN.md`: **0 errors**; eight orphan-token warnings because runtime CSS owns the semantic tokens and the document mirrors them rather than generating all component recipes.

## Remaining verification limits

The renderer unit/browser verification does not substitute for a real microphone or signed-in account trial. Root integration is responsible for the final live account and packaged neural-voice checks. Actual local voice model installation, audio quality, and live model availability require the user's fresh desktop sign-in/audio setup. Keyboard/modal checks, reduced-motion rendering, native model selection, and 390px responsive layouts were exercised; this is not a full screen-reader or WCAG conformance audit. No browser fixture is imported by the production entry.


## Continuous voice and lesson-depth update

Voice input is now a continuous local PCM pipeline. A validated RMS detector rejects short clicks, keeps a short pre-roll, and identifies speech/silence. Draft recognition is scheduled about once per second with one in-flight local request and overlapping audio windows capped at eight seconds. Final recognition follows silence; long speech is split into bounded jobs without submitting a turn while speech continues. Late/cancelled results are discarded. The same microphone remains open across questions and teacher turns until the learner disables voice or leaves the lesson.

Spoken questions appear as live drafts and send automatically after a 650ms Cancel & edit grace period. Initial topics remain visible and editable before the learner explicitly begins, protecting against wrong-topic recognition. Manual text edits invalidate a pending voice draft. Speaker mode suspends recognition during teacher playback and briefly afterwards; Interrupt & speak stops the teacher explicitly. The optional headphones setting allows voice onset to interrupt playback. No browser remote speech-recognition API is used.

Teacher text follows the PCM audio clock at word granularity. The interface labels duration-derived word pacing as approximate; persisted heard prefixes advance only after a spoken chunk finishes. One next synthesis request runs while the current audio plays, with at most the current and next PCM segment buffered. Playback epochs discard prefetched results after cancellation. Local browser fallback prefers installed female English voices. Settings expose the explicit approximately 350MB Kokoro female voice setup and actual reported voice name.

Completed acknowledged beats marked `next: continue` request the next teaching step exactly once without appending a synthetic learner message. Model availability can prevent teaching; the UI shows requested/served model metadata from actual events and explicitly says when the served model was not reported. The selected model is preserved and shown as unavailable when appropriate.

New regression coverage includes continuous capture, partial/final recognition sequencing, voice-draft cancellation, topic correction, renewed/long utterances, echo gating, audio-clock word display, bounded synthesis prefetch, and teacher continuation. Final TypeScript and renderer ESLint checks exit 0; the browser workflow harness again passed all six scenarios with no page errors.

Latency remains dependent on local CPU/model throughput: the one-second recognition schedule is a target for requesting a draft, not a promise that recognition finishes within one second. The UI shows when local recognition is catching up.
