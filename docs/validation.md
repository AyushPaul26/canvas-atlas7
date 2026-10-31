# Validation record — 2026-10-22

This is a record of observed checks, not a claim of educational correctness or unlimited account access.

## Observed

- Production Electron/Vite main, preload, renderer, worker, and WASM build completed.
- `npm run package` produced `release/win-unpacked/Living Canvas.exe` successfully.
- Actual Electron desktop shell test passed: local UI loads, renderer has no Node process/require, external navigation is denied while the actual document remains local, and a saved lesson survives an offline restart.
- Actual Electron simulation test passed: a supplied program initializes/advances, host capabilities are absent in the QuickJS guest, a runaway loop is interrupted, another program runs afterwards, the hidden host uses a different process with no app bridge/Node globals, and an external fetch is denied.
- The same simulation-boundary test passed against the packaged Windows executable.
- Core QuickJS replay tests compare closure state, seeded randomness, render calls, input changes, and the next step after restoration.
- Latest Graphify code-only extraction completed with 594 nodes and 1,213 edges. Private data, weights, and build outputs remain excluded.
- Kokoro af_heart produced real female neural PCM locally and base.en recognized a fresh gravitation phrase. See voice-report.md and neural-voice-trial.json for measurements and limitations.

## Final integrated checks

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- Latest `npm test`: 120 passed, one optional SAPI hardware trial skipped, across 27 files.
- `npm run test:e2e`: three actual desktop tests passed, including normal OS-window close saving a playing experiment without manual edits.
- Packaged executable simulation/replay/isolation test: passed after the final runtime fixes; includes successful/failed preflights retaining the current experiment.
- `npm run dist -- --publish never`: passed and produced the refreshed 122 MB Windows installer plus the runnable directory package. Nothing was published.
- Independent core/runtime/presentation reviews found defects; fixes were checked with regressions for strict tool compatibility, scene/context bounds, namespace ownership, cancellation during boot/queueing, replay getter/closure/RNG behavior, live-context preservation, visible/heard checkpoints, late presentation acknowledgements, static board replacement, model selection, navigation/export, and close persistence.
- Renderer browser harness: six scenarios passed, no page errors; desktop and narrow-window screenshots are in frontend-evidence/. This harness uses test-only synthetic events and is not evidence of live provider teaching.

Earlier snapshots included expected failures while implementing these changes. Counts above refer to the settled source. Real device/account acceptance remains separate below.

## User-dependent acceptance

The user completed fresh official ChatGPT sign-in. A real gravitation lesson subsequently verified two requested/served `gpt-6-astra` responses through the normal desktop UI, with an automatically requested second explanation and a newly generated Newtonian force/equation diagram. Presentation acknowledgments came from real UI/audio progression. The first explanation completed; the second response arrived and was paused during preparation. See live-tutor-trial.md. Broader novel-topic quality, adaptation, complete curricula, and plan-limit behavior remain unverified. The app contains no production tutor-response mocks.

English base.en recognition and Kokoro FP32 female voice are installed for this authorized update. New voice tests cover rolling transcription, silence finalization, bounded overlapping input windows, stale-output cancellation, echo gating, headphone mode, estimated live words, single-segment prefetch, and completed-chunk checkpoints. A fresh neural-to-recognizer round trip recognized gravitation. Physical microphone quality, speaker/headset echo, perceived naturalness, and actual speaker-stop latency still require device trials. Speaker mode suspends recognition during playback; headphone mode permits spoken interruption without claiming acoustic echo cancellation.

Generated models are labelled illustrative. Tests establish containment, bounded execution, and consistent computation for test programs; they do not establish a generated model's scientific validity.

Runtime dependency audit was clean. The packaging development chain reported eight moderate transitive advisories involving sprintf-js through global-agent/@electron/get/electron-builder; they do not affect the production runtime dependency audit. Build output includes advisory bundler messages for lucide-react module directives. The app currently uses Electron's default application icon and an unsigned local development distribution.

## Sign-in network correction

The user's first real connection attempt failed before opening the browser with `TypeError: fetch failed`. A credential-free probe on this computer reproduced `SELF_SIGNED_CERT_IN_CHAIN` using Node's built-in fetch. Electron's Chromium transport reached the same public OpenAI identity-discovery URL with HTTP 200 and the expected issuer and authorization origin.

The desktop composition now injects one Chromium-backed fetch into authentication (including token/JWKS/refresh/revocation), model discovery/inference, and explicit voice-model downloads. It uses a separate nonpersistent session, omits browser cookies, disables response caching, preserves request headers/body/signals, and leaves normal certificate validation enabled. No certificate bypass or global trust change was made. UI and generated-code network restrictions are unchanged.

Observed checks for the earlier sign-in correction: 80 unit/integration tests passed; one optional hardware test skipped. Direct TypeScript and ESLint checks passed. All four desktop checks passed, including a real-network sign-in trial and simulation isolation/replay against the rebuilt Windows executable. The installer was regenerated successfully without publishing. The network trial reached the official browser handoff through the patched production auth composition, then canceled before account authorization. It intercepts the opener, uses no credentials, and does not claim a completed account sign-in. It is opt-in with `LIVING_CANVAS_NETWORK_TRIAL=1`; ordinary offline desktop checks skip it. Subsequent signed-in teaching evidence is recorded above and in live-tutor-trial.md.

## Voice and tutor upgrade

The saved preference was exactly gpt-6-astra; historical served-model metadata was absent. The prior first request and answer concerned cavitation, which differed from the user's intended gravitation. These are separate observations; neither answer style nor the new trial establishes the historical served model. Fresh requests now retain exact selected IDs, reject unavailable choices, and persist independently reported model metadata. See model-selection-audit.md.

Lesson progression requires explicit continue/ask/finish decisions. Fresh calls missing this decision receive repair feedback. Continuation requires completed accepted presentation, current epoch/model, and preserved selection focus; it adds no invented student messages. A bounded automatic-round cap settles to ready. Independent review and regressions cover these behaviors.

The latest direct TypeScript/ESLint checks and 120-test suite passed. Three ordinary desktop tests passed; installed-model and public-network trials remain opt-in.

The final packaged executable passed the generated-simulation isolation/replay/recovery check and the installed neural voice trial. HTTP/HTTPS requests through the desktop transport were blocked and counted for the latter; the attempt count stayed zero. Kokoro produced nonzero 24 kHz PCM for two fresh phrases, and base.en recognized “Today, I would like to learn about gravitation.” The trial confirmed Kokoro readiness rather than accepting SAPI fallback. Active inference cancellation rejected in 65 ms including the test's 50 ms delay. Packaged synthesis measured 2,598 ms for 2.501 seconds and 6,791 ms for 3.462 seconds; recognition took 4,546 ms. These slower observations are retained alongside the earlier service measurements instead of promising a fixed one-second latency. Physical microphone/echo behavior was not tested by this generated-audio trial.

The refreshed NSIS installer and runnable directory package were generated successfully without publishing. The existing Start Menu shortcut still targets release/win-unpacked/Living Canvas.exe. A failed first version of the neural test expected the internal speaker ID in a human-readable status label; the corrected test checks the actual Heart female label and Kokoro engine, then passed the full inference/recognition/cancellation path.
