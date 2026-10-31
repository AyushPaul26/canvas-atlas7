import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { ModelManager, RECOGNITION_MODELS, RUNTIME_FILES, WHISPER_RUNTIME } from '../../../../../packages/voice/src/models.js';
import { KOKORO_MODEL, KOKORO_DIRECTORY, verifyNeuralModel } from '../../../../../packages/voice/src/neural-model.js';
import { decodePcmWav, validateRecognitionWav } from '../../../../../packages/voice/src/recognition.js';
import { segmentNarration } from '../../../../../packages/voice/src/synthesis.js';
import type { AudioSegment, JobContext, VoiceStatus } from '../../../../../packages/voice/src/contracts.js';
import { runLocalProcess } from './process.js';
import { getOfflineVoices, runPowerShell, synthesizeWindows } from './windows-sapi.js';
import { NeuralTtsWorker } from './neural-tts.js';

export interface VoiceServiceOptions {
  modelDirectory?: string;
  dataDir?: string;
  resourcesPath?: string;
  onProgress?: (status: VoiceStatus) => void;
  voiceName?: string;
  neuralWorkerPath?: string;
  fetch?: typeof fetch;
}
const extractionScript = `
$ErrorActionPreference = 'Stop'
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($request.zip)
try {
  [IO.Directory]::CreateDirectory($request.destination) | Out-Null
  foreach ($name in $request.files) {
    $entry = $zip.GetEntry('Release/' + $name)
    if ($null -eq $entry -or $entry.Length -gt 10000000) { throw 'Invalid runtime archive' }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, [IO.Path]::Combine($request.destination, $name), $false)
  }
} finally { $zip.Dispose() }
`;

/** Resident JS coordinator; all inference runs in killable child processes. Never fetches during a lesson. */
export function createVoiceService(options: VoiceServiceOptions) {
  const directory = options.modelDirectory ?? options.dataDir;
  if (!directory) throw Error('Voice modelDirectory is required');
  const manager = new ModelManager(directory, options.fetch); const runtimeDirectory = join(directory, 'whisper-runtime-v1.8.2');
  const neuralDirectory = join(directory, KOKORO_DIRECTORY);
  let neural: NeuralTtsWorker | undefined;
  let offlineVoice: string | undefined;
  function neuralWorker() {
    if (disposed) throw Error('Voice service is disposed');
    if (neural) return neural;
    const base = options.resourcesPath ?? join(process.cwd(), 'resources');
    const workerPath = options.neuralWorkerPath ?? [join(base, 'voice', 'kokoro-worker.cjs'), join(base, 'resources', 'voice', 'kokoro-worker.cjs')].find(existsSync);
    if (!workerPath) throw Error('The local neural voice helper is missing. Repair the app installation.');
    const resolvedAddon = createRequire(import.meta.url).resolve('sherpa-onnx-node');
    const unpackedAddon = resolvedAddon.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    const addonPath = existsSync(unpackedAddon) ? unpackedAddon : resolvedAddon;
    neural = new NeuralTtsWorker({ workerPath, addonPath, modelDirectory: neuralDirectory, threads: 4 });
    return neural;
  }
  let state: VoiceStatus = { recognitionReady: false, synthesisReady: false };
  let selectedModel: typeof RECOGNITION_MODELS[number] | undefined;
  let disposed = false; let generation = 0; let installing = false;
  let recognitionBusy = false; let synthesisBusy = false;
  const jobs = new Set<AbortController>();
  function emit(next: Partial<VoiceStatus>) { state = { ...state, ...next }; options.onProgress?.({ ...state }); }
  async function runtimeReady(path = runtimeDirectory) { const runtime = new ModelManager(path, options.fetch); return (await Promise.all(RUNTIME_FILES.map(f => runtime.verify(f)))).every(Boolean); }
  async function refresh() {
    selectedModel = undefined;
    if (process.platform === 'win32' && process.arch === 'x64' && await runtimeReady()) {
      for (const model of [...RECOGNITION_MODELS].reverse()) if (await manager.verify(model)) { selectedModel = model; break; }
    }
    let synthesisReady = false; let error: string | undefined; let neuralReady = false;
    try { const voices = await getOfflineVoices(); offlineVoice = options.voiceName ?? voices[0]?.name; synthesisReady = true; } catch (e) { error = String(e instanceof Error ? e.message : e); }
    if (await verifyNeuralModel(neuralDirectory)) {
      try { await neuralWorker().prepare(); neuralReady = true; synthesisReady = true; error = undefined; } catch (e) { error = 'Neural voice could not load: ' + (e instanceof Error ? e.message : String(e)); }
    }
    if (!disposed) emit({ recognitionReady: !!selectedModel, synthesisReady, neuralReady, synthesisEngine: neuralReady ? 'kokoro' : synthesisReady ? 'windows-sapi' : null, voiceName: neuralReady ? 'Heart · natural female English' : offlineVoice, error });
  }
  const initialized = refresh();
  function assertLive() { if (disposed) throw Error('Voice service is disposed'); }
  function cancel() { generation++; for (const job of jobs) job.abort(); jobs.clear(); neural?.cancel(); }
  function job(context?: JobContext) {
    assertLive(); const controller = new AbortController(); const current = generation;
    const abort = () => controller.abort();
    if (context?.signal?.aborted) controller.abort(); else context?.signal?.addEventListener('abort', abort, { once: true });
    jobs.add(controller);
    return { signal: controller.signal, check() { controller.signal.throwIfAborted(); if (disposed || current !== generation) throw Error('Voice result belongs to canceled epoch'); }, close() { jobs.delete(controller); context?.signal?.removeEventListener('abort', abort); } };
  }
  async function tempJob() { await mkdir(join(directory!, 'jobs'), { recursive: true }); return mkdtemp(join(directory!, 'jobs', 'job-')); }
  return {
    async status(): Promise<VoiceStatus> { await initialized; return { ...state }; },
    async voices() { assertLive(); return getOfflineVoices(); },
    cancel,
    async installModel(id: string): Promise<VoiceStatus> {
      await initialized; assertLive();
      if (installing) throw Error('A voice model download is already in progress');
      if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('This local recognition runtime requires Windows x64');
      if (id === KOKORO_MODEL.id) {
        cancel(); const work = job(); installing = true;
        emit({ downloading: id, progress: 0, error: undefined, neuralReady: false });
        const staging = join(directory, `neural-staging-${randomUUID()}`);
        try {
          if (!await verifyNeuralModel(neuralDirectory)) {
            const archive = await manager.install(KOKORO_MODEL, progress => emit({ progress: progress * 0.9 }), work.signal);
            await mkdir(staging, { recursive: true });
            const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
            const listing = await runLocalProcess(tar, ['-tjf', archive], { signal: work.signal, timeoutMs: 60000, maxOutputBytes: 256 * 1024 });
            if (listing.stdout.split(/\r?\n/).filter(Boolean).some(path => !path.startsWith(KOKORO_DIRECTORY + '/') || path.split('/').includes('..') || path.includes('\\'))) throw Error('Invalid neural voice archive paths');
            await runLocalProcess(tar, ['-xjf', archive, '-C', staging], { signal: work.signal, timeoutMs: 120000 });
            emit({ progress: 0.95 });
            const extracted = join(staging, KOKORO_DIRECTORY);
            if (!await verifyNeuralModel(extracted)) throw Error('Neural voice files failed SHA-256 verification');
            work.check(); await rm(neuralDirectory, { recursive: true, force: true }); await rename(extracted, neuralDirectory);
          }
          work.check(); await neuralWorker().prepare(); work.check();
          emit({ synthesisReady: true, neuralReady: true, synthesisEngine: 'kokoro', voiceName: 'Heart · natural female English', downloading: undefined, progress: undefined, error: undefined });
        } catch (error) { emit({ neuralReady: false, downloading: undefined, progress: undefined, error: error instanceof Error ? error.message : String(error) }); throw error; }
        finally { installing = false; work.close(); await rm(staging, { recursive: true, force: true }); }
        return { ...state };
      }
      const model = RECOGNITION_MODELS.find(m => m.id === id); if (!model) throw Error('Unknown voice model');
      cancel(); const work = job(); installing = true;
      emit({ downloading: id, progress: 0, error: undefined, recognitionReady: false });
      const staging = join(directory, `runtime-staging-${randomUUID()}`);
      try {
        if (!await runtimeReady()) {
          const zip = await manager.install(WHISPER_RUNTIME, progress => emit({ progress: progress * 0.08 }), work.signal);
          await runPowerShell(extractionScript, { zip, destination: staging, files: RUNTIME_FILES.map(f => f.filename) }, work.signal);
          if (!await runtimeReady(staging)) throw Error('Extracted runtime SHA-256 verification failed');
          work.check(); await rm(runtimeDirectory, { recursive: true, force: true }); await rename(staging, runtimeDirectory);
        }
        await manager.install(model, progress => emit({ progress: 0.08 + progress * 0.92 }), work.signal);
        work.check(); selectedModel = model; emit({ recognitionReady: true, downloading: undefined, progress: undefined, error: undefined });
      } catch (e) {
        emit({ recognitionReady: false, downloading: undefined, progress: undefined, error: e instanceof Error ? e.message : String(e) }); throw e;
      } finally { installing = false; work.close(); await rm(staging, { recursive: true, force: true }); }
      return { ...state };
    },
    async transcribe(wav: ArrayBuffer, context?: JobContext): Promise<string> {
      assertLive(); validateRecognitionWav(new Uint8Array(wav)); await initialized;
      if (recognitionBusy || installing) throw Error('Local recognition is busy');
      if (!selectedModel || !state.recognitionReady) throw Error('Install an English recognition model in Voice settings first');
      recognitionBusy = true; const work = job(context); let temporary: string | undefined;
      try {
        if (!await manager.verify(selectedModel) || !await runtimeReady()) { emit({ recognitionReady: false, error: 'Local recognition files are missing or corrupt. Reinstall the voice model.' }); throw Error(state.error); }
        work.check(); temporary = await tempJob(); const input = join(temporary, 'microphone.wav'); const output = join(temporary, 'transcript');
        await writeFile(input, new Uint8Array(wav));
        const hint = context?.recognitionHint?.trim().slice(0, 500);
        const args = ['-m', manager.path(selectedModel), '-f', input, '-l', 'en', '-t', '4', '-ng', '-nt', '-otxt', '-of', output];
        if (hint) args.push('--prompt', 'An English learning conversation about: ' + hint);
        await runLocalProcess(join(runtimeDirectory, 'whisper-cli.exe'), args, { signal: work.signal, timeoutMs: 120000, cwd: runtimeDirectory });
        work.check(); const transcriptFile = output + '.txt'; if ((await stat(transcriptFile)).size > 16000) throw Error('Recognition transcript exceeds limit');
        const transcript = (await readFile(transcriptFile, 'utf8')).trim(); work.check(); return transcript;
      } finally { recognitionBusy = false; work.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); }
    },
    async synthesize(text: string, context?: JobContext): Promise<AudioSegment | null> {
      assertLive(); const segments = segmentNarration(text); if (!segments.length) return null; await initialized;
      if (!state.synthesisReady) return null;
      if (synthesisBusy) throw Error('Local synthesis is busy');
      synthesisBusy = true; const work = job(context); let temporary: string | undefined;
      try {
        temporary = await tempJob(); const chunks: Float32Array[] = []; let sampleRate = 24000; let length = 0;
        for (let i = 0; i < segments.length; i++) {
          if (state.neuralReady) {
            try {
              const audio = await neuralWorker().synthesize(segments[i], work.signal); work.check();
              sampleRate = audio.sampleRate; length += audio.samples.length; if (length > sampleRate * 300) throw Error('Narration exceeds five minutes'); chunks.push(audio.samples); continue;
            } catch (error) {
              if (work.signal.aborted) throw error;
              emit({ neuralReady: false, synthesisEngine: offlineVoice ? 'windows-sapi' : null, synthesisReady: !!offlineVoice, voiceName: offlineVoice, error: 'Neural voice stopped; using the installed offline fallback. ' + (error instanceof Error ? error.message : String(error)) });
              if (!offlineVoice) throw error;
            }
          }
          work.check(); const output = join(temporary, `${i}.wav`); await synthesizeWindows(segments[i], output, options.voiceName, work.signal);
          work.check(); if ((await stat(output)).size > 8 * 1024 * 1024) throw Error('Synthesized segment exceeds limit');
          const decoded = decodePcmWav(await readFile(output));
          if (decoded.sampleRate !== 24000) throw Error('Unexpected local voice sample rate');
          sampleRate = decoded.sampleRate; length += decoded.samples.length; if (length > sampleRate * 300) throw Error('Narration exceeds five minutes'); chunks.push(decoded.samples);
        }
        work.check(); const samples = new Float32Array(length); let offset = 0; for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
        return { samples, sampleRate };
      } catch (e) { if (!work.signal.aborted) emit({ error: e instanceof Error ? e.message : String(e) }); throw e; }
      finally { synthesisBusy = false; work.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); }
    },
    dispose() { disposed = true; cancel(); neural?.dispose(); },
  };
}
