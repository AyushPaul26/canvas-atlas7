# Conversational tutor correction — 2026-10-22

The user has successfully signed in and used the tutor. Their current problems are a robotic male voice, manually stopped recordings, and a gravitation lesson that ends at a basic definition despite selecting ChatGPT-6 Astra. Keep the existing local architecture and account connection.

## Required behavior

- Keep the exact chosen model ID stable across catalog refresh/restart. Never silently substitute another model. Record the requested ID and the model reported by each completed response; older turns without metadata remain unknown.
- Teach a broad topic progressively: intuition, causal explanation, relevant formal relationships, worked examples, and purposeful checks. Two short queued beats are a pacing bound, not the total lesson. Continue only after actual presentation completes; student questions, edits, pause, model changes, and closing revoke continuation.
- Use a natural female local neural voice when installed, with an explicit female Windows fallback. Keep synthesis off the main thread, cancelable, and offline during inference. Pin and verify downloaded assets.
- Allow continuous local speech capture with live partial transcript, automatic end-of-utterance detection, and automatic submission. Keep one recognition job in flight, discard stale results, and preserve typed input. Suspend speaker-fed recognition during playback by default; provide a clearly labelled headphone mode/explicit interrupt path until physical echo trials establish reliable duplex behavior.
- Reveal the tutor transcript against playback time, with completed-sentence checkpoints as conservative evidence. Estimated word timing must not be called forced alignment.

## Work and checks

1. Audit the existing model preference, request and response path, and actual app-owned lesson metadata without reading credentials. Preserve all user data; investigate any storage diagnostic before repair.
2. Add explicit model availability and requested/reported model records, with tests for catalog order, missing selections, concurrent changes, and completed-response provenance.
3. Add validated continuation intent and an epoch-checked, once-only continuation operation. Test continued learning after acknowledgement, deliberate pauses, duplicates, partial presentation, and cancellation.
4. Implement local neural female synthesis and bounded rolling recognition/VAD, with generated PCM trials and cancellation tests.
5. Integrate the existing UI, test actual desktop behavior and package/native assets, then update the installed shortcut target's build. Measure and report what was actually exercised; do not infer model identity from answer style or claim microphone/AEC quality from synthetic tests.
