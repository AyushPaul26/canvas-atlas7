# Local voice implementation and evidence

Recorded 2026-10-22 on Windows x64, Intel Core i5-13450HX, 24 GB RAM. This report covers local adapters and generated-audio trials. Physical microphone, speaker/headset echo, and perceived naturalness remain separate acceptance work.

## Supported voice paths

The default installed narration voice is **Kokoro v1.0, af_heart**, an American female neural voice (official speaker ID 3), running locally through **sherpa-onnx-node 1.13.8** and **sherpa-onnx-win-x64 1.13.8** on the CPU. The worker returns fresh mono 24,000 Hz Float32 PCM. A resident hidden child retains the loaded model between requests; cancellation kills active inference, rejects stale output, and permits a clean restart. Idle cancellation preserves the warmed model.

Full precision is selected after a controlled CPU comparison: the same freshly synthesized gravitation sentence took **932 ms with FP32/four threads**, versus **2,675 ms with INT8/four threads** and **4,780 ms with INT8/one thread**. The final Electron service generated 2.501 seconds of speech in **888 ms**, with the next two samples taking 1,799 and 2,004 ms. Complete measurements, including PCM duration and cancellation, are in `docs/neural-voice-trial.json`. These few samples are not p50/p95 benchmarks or evidence of universal perceptual quality; no human listening score is claimed.

The offline recovery voice prefers **Microsoft Zira Desktop**, then another installed English female SAPI voice. The actual Windows voice probe selected Zira. The older SAPI-only report is superseded by this implementation. Neural inference is real; it is not browser recognition, prerecorded narration, or a remote TTS API.

Recognition uses the pinned official **whisper.cpp v1.8.2 Windows x64 CPU** prebuilt CLI and four DLLs. `whisper-base-en` is preferred when both English models are installed; tiny.en remains the smaller optional download. Actual app-owned storage contained base.en at the expected 147,964,211 bytes. No historical user audio or credentials were inspected.

## Setup, verification, and privacy

`installModel('kokoro-female-en')` is the explicit setup action. The official FP32 archive is **349,906,910 bytes**, with SHA-256 `c5f7e2d2caf082bc1d20fb70334a61d99d20b484500aad32e7cf84c128ea3298`. It includes model, voice embeddings, tokens, English lexicon, phonemizer data, and upstream notices. All **377 extracted files** have recorded individual sizes and SHA-256 values in `resources/models/kokoro-files.json`. Installation verifies archive size/hash, checks archive paths, extracts into staging, verifies every file, and only then activates it. Readiness is emitted only after the native model actually loads.

The user explicitly authorized this upgrade and its necessary downloads. Both official comparison archives were downloaded through Electron Chromium fetch with normal certificate verification. The selected FP32 model was installed into the actual `%APPDATA%/living-canvas/voice` directory using the trusted service. No TLS checks were disabled. Other installations still require an explicit setup action; constructors, local status checks, transcription, and synthesis do not download anything.

The injected Chromium fetch client is used only for explicit pinned artifact downloads. All model loading, phonemization, inference, PCM generation, and speech recognition stay local. Temporary microphone WAVs/transcripts and SAPI WAVs are removed on success, failure, and cancellation. Neural audio passes over a bounded local pipe; it is never included in provider requests.

The selected archive contains Apache-2.0 Kokoro material and GPL-3.0-or-later eSpeak NG phonemizer data. Runtime and model notices are retained under `resources/models`; sherpa is Apache-2.0 and ONNX Runtime is MIT. Windows voices are OS components and their weights are not redistributed. Exact artifact/package information is recorded in `resources/models/manifest.json`; runtime dependencies are pinned in the package lock.

## Contracts and bounds

`createVoiceService({modelDirectory, resourcesPath, fetch, onProgress, voiceName?})` retains the existing public methods `status`, `installModel`, `transcribe`, `synthesize`, and `dispose`, plus `cancel` and `voices`. Status adds optional `neuralReady`, `synthesisEngine`, and `voiceName`. The synthesis result remains `{samples: Float32Array, sampleRate: number}`; it does not contain word timestamps or forced alignment.

Recognition accepts mono signed 16-bit 16,000 Hz RIFF WAV, 0.01–30 seconds. Optional service job context can provide a bounded `recognitionHint` (500 characters) derived from the current learner topic. It is passed as a separate trusted CLI argument. No subject is hardcoded, and the first topic is not assumed. IPC/UI forwarding of this optional hint is coordinated separately by the root workstream.

Narration remains fresh text, split into at-most-600-character service segments; the renderer submits smaller sentences/chunks for first-audio latency. Requests are capped at 12,000 characters/five minutes of PCM, with one active synthesis job. Worker startup and inference each have a timeout, output is bounded, and PCM metadata/finite samples are validated before use. Text travels through JSON stdin, never shell interpolation or SSML.

The native helper explicitly requests copied buffers (`enableExternalBuffer: false`) because Electron's V8 memory cage rejects external native buffers. A regression test reproduces that contract. The main process never loads the neural addon or executes inference. Packaged module resolution prefers `app.asar.unpacked`, and the root packaging configuration unpacks the full native JS/platform packages. The helper is shipped separately at `resources/voice/kokoro-worker.cjs`.

## Actual trials and remaining evidence

Fresh generated samples are saved in `docs/voice-samples/kokoro-heart-0.wav` through `-2.wav`; they are evaluation outputs and are not imported by production lesson code. `docs/neural-voice-trial.json` records actual Electron synthesis timing, duration, peak/RMS, local recognition, and cancellation. The trial rejects measurements if the service falls back to SAPI.

The neural gravitation sentence was downsampled locally to the recognizer's WAV format and decoded by the actual installed base.en CPU engine without a subject hint. It recognized **gravitation**, with only punctuation differences. This verifies a fresh generated-audio round trip, not the accuracy of a particular human microphone/accent. The earlier user microphone confusion between gravitation and cavitation is not claimed fixed by this synthetic test alone. Editable visible recognition and broader microphone evaluation remain necessary.

Scoped deterministic voice tests: **26 passed**, with one explicit SAPI hardware trial skipped by default. Coverage includes pinned manifest parity, absent/corrupt/incomplete files, hash mismatch and interruption, injected download transport, worker residency/restart/death, canceled output, copied-buffer compatibility, disposal during voice probing, bounds, base-over-tiny selection, and bounded optional recognition hints. Scoped ESLint and the full TypeScript check passed. Root owns integrated and packaged smoke verification. No physical playback, echo cancellation, actual human microphone accuracy, forced word alignment, or measured 150 ms speaker-stop result is claimed here.

Root's final packaged-executable trial also passed: Kokoro was confirmed ready, two fresh 24 kHz outputs contained nonzero PCM, generated gravitation audio was recognized correctly, and active cancellation rejected after 65 ms including a 50 ms test delay. All HTTP/HTTPS requests through the desktop transport were blocked during this trial; zero attempts occurred. Packaged synthesis timings were 2,598 ms for 2.501 seconds of audio and 6,791 ms for 3.462 seconds; recognition took 4,546 ms. These measurements show variable local latency and do not guarantee real-time-factor performance. The packaged simulation-boundary test passed separately. See validation.md; physical audio/device acceptance remains outstanding.

Official sources: [sherpa Node installation](https://k2-fsa.github.io/sherpa/onnx/javascript-api/install.html), [Kokoro model and speaker mapping](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html), [Electron native buffer compatibility](https://k2-fsa.github.io/sherpa/onnx/faqs/index.html), [official model release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models).
