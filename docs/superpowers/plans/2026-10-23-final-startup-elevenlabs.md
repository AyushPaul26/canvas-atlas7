# Canvas Atlas Final Startup and ElevenLabs Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for implementation, with independent startup and voice work delegated where useful and one focused final review. Steps use checkbox syntax for tracking.

**Status:** The user approved the opening fix first. Startup hotfix `0.1.1` is implemented, installed, and verified through the actual Start shortcut on 23 October 2026. ElevenLabs tasks remain proposed. See `docs/canvas-atlas-visual-companion-validation.md` for hotfix evidence.

**Goal:** Make Canvas Atlas open reliably from Windows Start and let each user connect their own ElevenLabs account, choose a voice, and hear synchronized lesson narration.

**Architecture:** Keep the Electron/React app and existing PCM audio clock. Fix the application lifecycle and install one version into a stable location; add a main-process ElevenLabs adapter that produces the same audio data as local synthesis. Keep microphone recognition local and retain local narration as a selectable option.

**Tech stack:** Existing Electron, React, TypeScript, SQLite, Electron safeStorage, Chromium-backed fetch, Vitest, Playwright, and electron-builder/NSIS. No additional runtime SDK is required.

**Spec:** The user's 23 October 2026 request and the proposed design below. Approval covers this focused final release, including installing it and repairing the known Canvas Atlas Start shortcut.

## Findings and proposed design

The current per-user Start shortcut targets `release/win-unpacked/Canvas Atlas.exe`; the latest verified build is in `release/visual-companion/win-unpacked`. Both files exist. Main startup acquires a single-instance lock but has no second-instance handler, so a repeated launch cannot restore/focus the first window. Saved document initialization also runs before the renderer loads. Its contribution to the user's delay still needs measurement.

Recommended approach: repair those launch paths, show startup progress promptly, and integrate ElevenLabs behind the existing audio interface. Replacing only the shortcut would leave repeat-launch and startup feedback defects. Replacing the playback engine with a new streaming/WebSocket implementation would add substantial regression risk to pause/resume and visual synchronization; it is unnecessary for this release.

The voice settings will offer Local or ElevenLabs, a masked API-key field with save/replace/remove, searchable voices available to the connected account, a short preview, and restrained tuning. Existing speaking speed remains the single speed control. Stability and similarity use bounded controls; style can be offered only for the selected supported model. Start with the documented `eleven_multilingual_v2` model for consistent narration, subject to account/live compatibility validation. Voice creation or cloning, sound effects, and replacement of ChatGPT inference or Whisper recognition are outside this release.

## Global constraints

- Preserve application identity `org.livingcanvas.desktop` and existing profile discovery, account connection, lessons, materials, and local voice models.
- Preserve the current uncommitted work; no reset, unrelated refactor, publishing, or automatic Git commit.
- Enter API keys in the application, never in chat, source code, lesson exports, logs, or renderer persistent storage. Store the key in a separate OS-encrypted file under the active user profile; refuse plaintext fallback.
- Main process alone makes ElevenLabs requests, through the existing network client. Keep the renderer/simulation network restrictions intact.
- Default to the existing local provider until the user explicitly configures ElevenLabs. Explain that cloud narration sends spoken lesson text to ElevenLabs and consumes the user's quota; microphone transcription stays local.
- Preserve actual-audio completion and visual/checkpoint acknowledgement rules. Failure or cancellation must not advance a lesson as though speech was heard.
- Use the existing bounded lesson chunks and one-chunk prefetch. No full-lesson cloud generation or automatic repeated paid retries.
- Produce a clearly versioned final installer (proposed version `0.2.0`) and one installed Start-menu target. Keep old build files as recovery artifacts.

## Review focus

1. Repeated Start clicks while minimized or still starting must restore the existing window without opening a second lesson database instance (Task 1/5).
2. Slow or failed saved-material initialization must provide visible progress/error without exposing incomplete document state (Task 1).
3. Invalid/restricted keys, empty voice lists, unavailable voices, quota exhaustion, and offline operation must have actionable recovery without leaking secrets (Task 2/3).
4. Mute, interruption, preview stop, navigation, and provider/voice changes must cancel the correct requests and discard stale audio without canceling valid next-chunk prefetch (Task 4).
5. Installing over the current app must repair the actual Start shortcut and retain the existing profile; checking an unpacked executable alone is insufficient (Task 5).

## Task 1: Reliable startup and window activation

**Files:** Modify `apps/desktop/src/main/app.ts`, `window.ts`, and document initialization/IPC gating as needed. Add small `startup-lifecycle.ts` and `startup-diagnostics.ts` modules if they keep orchestration testable. Extend `tests/e2e/desktop-shell.spec.ts`; add focused `tests/unit/startup-lifecycle.test.ts`.

**Interfaces:** A lifecycle controller receives second-instance events before initialization finishes, attaches the completed main window, and applies pending `restore/show/focus`. A shared document-readiness promise gates material-dependent operations while the shell can render.

- [ ] Add regression tests for minimized-window restoration, a second launch during initialization, and slow/failing material initialization; confirm the existing behavior fails them.
- [ ] Register second-instance handling before asynchronous startup, retain the main window reference, and focus it safely when ready.
- [ ] Show a startup shell promptly; keep mandatory database initialization safe, move nonessential document processing behind readiness, and defer optional voice warmup until the shell appears. Avoid loading Kokoro for selected cloud narration unless the user switches to local.
- [ ] Add bounded local startup stage timings and sanitized failure diagnostics with a useful visible recovery message. Never record lesson text or credentials.
- [ ] Run the startup unit tests and desktop shell checks; record cold/warm launch timings rather than claiming an unmeasured speed improvement.

## Task 2: Protected ElevenLabs configuration and audio adapter

**Files:** Add `apps/desktop/src/main/voice/elevenlabs-key-store.ts`, `elevenlabs-client.ts`, and `speech-provider.ts`; integrate with `app.ts` and `voice-worker-manager.ts`. Update `packages/voice/src/contracts.ts` and `packages/protocol/src/core.ts`. Add provider/key-store unit tests.

**Interfaces:** Public `VoiceConfiguration` contains provider, key-presence status, selected voice ID/name, supported model ID, and bounded voice settings; it never contains the saved key. `ElevenLabsClient.listVoices({search?, nextPageToken?}, signal)` returns sanitized catalog records and pagination. `ElevenLabsClient.synthesize(text, settings, signal)` returns `{samples: Float32Array, sampleRate: number}`.

- [ ] Test encrypted save/load/remove, refused unprotected storage, voice pagination, correct authentication, PCM decoding, invalid/oversized responses, timeout/abort, and 401/403/429/quota errors before implementation.
- [ ] Implement atomic safeStorage-protected key persistence separate from ChatGPT credentials. Persist only nonsensitive voice preferences; clearing the key aborts cloud work and clears cloud caches.
- [ ] Use `GET /v2/voices` with bounded search/pagination and `POST /v1/text-to-speech/:voice_id` with `output_format=pcm_24000`; convert signed 16-bit PCM into the existing Float32 audio format. Use request-scoped settings rather than changing account-global voice settings.
- [ ] Use fixed ElevenLabs API origins, bounded response sizes/timeouts, and sanitized mapped errors. Do not fetch arbitrary catalog preview URLs or forward keys across redirects.
- [ ] Route synthesis by the selected provider; recognition remains in the local service. Return quickly from voice status while optional local initialization proceeds. A cloud failure offers Retry or Use local voice; canceled requests never trigger fallback.
- [ ] Run the provider, credential, and existing local voice tests.

## Task 3: Voice selection and connection settings

**Files:** Update `main/ipc-router.ts`, `preload/app-bridge.ts`, renderer `bridge.ts`, `App.tsx`, and `styles.css`; add `renderer/voice/VoiceSettings.tsx` and its tests. Extend `tests/unit/ipc-boundary.test.ts`.

**Interfaces:** Add typed bridge methods for `getVoiceConfiguration`, `saveVoiceConfiguration`, `setElevenLabsKey`, `clearElevenLabsKey`, and `listElevenLabsVoices`. Validate every input in main, enforce the existing trusted-frame boundary, and return public configuration only.

- [ ] Test missing/invalid key handling, empty catalog and further pages, saved voice restoration, unsupported selection, key removal, and keyboard-accessible settings controls.
- [ ] Add Local/ElevenLabs selection, masked key entry, connection feedback, search/refresh/load-more for available account voices, voice selection, preview/stop, and bounded tuning. Retain the current speed control without also multiplying it by server-side speed.
- [ ] Preview a fixed short sample through the same main-process PCM path. Make quota use clear; avoid automatically synthesizing samples for every listed voice.
- [ ] Update provider-specific status and privacy copy throughout the app, including “Preparing local voice” and “Audio stays on your device.”
- [ ] Run settings and IPC boundary tests. Verify layout within the existing settings design rather than redesigning the application.

## Task 4: Cancellation and synchronized playback

**Files:** Update `renderer/audioPlayback.ts`, `useVoice.ts`, associated tests, bridge contracts, and main speech-provider/IPC handlers. Extend the existing visual lesson desktop fixture.

**Interfaces:** Extend synthesis with caller-generated request IDs and `cancelSpeech(requestId): Promise<void>`. The audio adapter passes an AbortSignal to synthesis; main tracks an AbortController per request. A provider/settings generation invalidates prepared audio. Cancellation is scoped so stopping a preview does not abort lesson recognition or unrelated requests.

- [ ] First reproduce the current gap: stopping playback can discard results without aborting main-process synthesis.
- [ ] Test request cancellation and stale completion on mute, navigation, interruption, preview stop, and provider change. Test that normal chunk transitions retain valid prefetched audio.
- [ ] Connect abort signals/request IDs, invalidate audio on provider/settings changes, and prevent preview playback from advancing lesson checkpoints. Apply configuration changes at a controlled paused boundary.
- [ ] Preserve pause/resume/replay, microphone echo gating, visual cue timing, and honest failure state using the existing AudioContext clock. Reuse in-memory prepared audio on pause/resume; do not promise free regeneration after restart.
- [ ] Run audioPlayback, useVoice, lesson playback, and visual lesson regression tests, including a simulated cloud PCM response.

## Task 5: Final installer and real Start-menu acceptance

**Files:** Update `package.json`/lockfile version, installer settings, `Launch Canvas Atlas.cmd`, and concise release/validation documentation. Add a focused packaged startup test or launch-check script where useful.

- [ ] Set the final version and explicit Canvas Atlas Start shortcut configuration while retaining the installer/application identity. Build to an isolated release output so the running app is not overwritten.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm test`, production build, and the relevant desktop suite after integration. Use one final independent review of the changed startup, key, and playback paths.
- [ ] Generate the NSIS installer and install to a stable per-user application location. Close the app through its normal save/checkpoint lifecycle before installation; do not force-kill active lesson work.
- [ ] Inspect and repair the known stale Canvas Atlas `.lnk` to the installed executable. Make the repository launcher resolve that same final version, with a packaged fallback only when appropriate.
- [ ] Launch through the actual Start shortcut, close/reopen, minimize/relaunch, and launch repeatedly during startup. Check offline startup and existing lesson/account/material continuity. Record measured timings and final executable version.
- [ ] Have the user enter their key directly in Settings, then validate a short preview and one bounded narrated lesson with pause, resume, interruption, and matching visuals. Clearly distinguish mocked checks from real ElevenLabs results. Live voice validation is the only step requiring the user's key and can happen after all other checks are ready.

## Execution order and completion evidence

After approval, startup work and the ElevenLabs adapter can proceed in parallel. Integrate settings and cancellation after the shared contracts are established; perform one focused review, build, and installed-app acceptance pass. Avoid unrelated feature work or repeated broad tests without a new failure/change.

Completion requires the actual Start shortcut to open the final installed version reliably, repeat launches to focus it, selected ElevenLabs audio to retain teaching synchronization, and no exposed saved key. Report any live-service limitation explicitly rather than treating mocked speech as live verification.

## Official API references checked for this plan

- [Authentication and key restrictions](https://elevenlabs.io/docs/api-reference/authentication)
- [Text-to-speech conversion and output formats](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- [Account voice search and pagination](https://elevenlabs.io/docs/api-reference/voices/search)
- [Model capabilities](https://elevenlabs.io/docs/api-reference/models/list)
- [Voice settings and speed](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech)
