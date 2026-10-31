import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createVoiceService, type VoiceServiceOptions } from '../../../apps/desktop/src/main/voice/voice-worker-manager.js';
import { getOfflineVoices } from '../../../apps/desktop/src/main/voice/windows-sapi.js';
import { ModelManager, RECOGNITION_MODELS, RUNTIME_FILES, WHISPER_RUNTIME } from '../src/models.js';
import * as localProcess from '../../../apps/desktop/src/main/voice/process.js';
import * as neuralModel from '../src/neural-model.js';
import { NeuralTtsWorker } from '../../../apps/desktop/src/main/voice/neural-tts.js';

vi.mock('../../../apps/desktop/src/main/voice/windows-sapi.js', () => ({
  getOfflineVoices: vi.fn(async () => [{ name: 'Fixture offline voice', culture: 'en-US' }]),
  runPowerShell: vi.fn(),
  synthesizeWindows: vi.fn(async (_text: string, _output: string, _voice: string, signal: AbortSignal) => new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('canceled')), { once: true }))),
}));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); vi.mocked(getOfflineVoices).mockResolvedValue([{ name: 'Fixture offline voice', culture: 'en-US' }]); });
async function service(options: Partial<VoiceServiceOptions> = {}) {
  const base = join(process.cwd(), '.voice-test-tmp'); await mkdir(base, { recursive: true }); const modelDirectory = await mkdtemp(join(base, 'service-'));
  const voice = createVoiceService({ modelDirectory, ...options }); cleanups.push(async () => { voice.dispose(); await rm(modelDirectory, { recursive: true, force: true }); }); return voice;
}
describe('honest service readiness and cancellation', () => {
  it('never starts a late neural worker after the voice service has been disposed', async () => {
    let resolveProbe!: (voices: Array<{ name: string; culture: string }>) => void;
    vi.mocked(getOfflineVoices).mockImplementationOnce(() => new Promise(resolve => { resolveProbe = resolve; }));
    vi.spyOn(neuralModel, 'verifyNeuralModel').mockResolvedValue(true);
    const prepare = vi.spyOn(NeuralTtsWorker.prototype, 'prepare').mockResolvedValue();
    const voice = await service(); await vi.waitFor(() => expect(resolveProbe).toBeTypeOf('function')); voice.dispose();
    resolveProbe([{ name: 'Zira fixture', culture: 'en-US' }]); await voice.status();
    expect(prepare).not.toHaveBeenCalled();
  });
  it.runIf(process.platform === 'win32' && process.arch === 'x64')('prefers verified base English over tiny and passes only a bounded optional subject hint', async () => {
    vi.spyOn(ModelManager.prototype, 'verify').mockResolvedValue(true);
    const invoke = vi.spyOn(localProcess, 'runLocalProcess').mockImplementation(async (_program, args) => { await writeFile(args[args.indexOf('-of') + 1] + '.txt', 'An accurate fresh transcript'); return { stdout: '', stderr: '' }; });
    const voice = await service(); await voice.status();
    const wav = Buffer.alloc(44 + 3200); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(3200, 40);
    expect(await voice.transcribe(wav.buffer, { recognitionHint: 'topic '.repeat(200) })).toBe('An accurate fresh transcript');
    const args = invoke.mock.calls[0][1]; expect(args[args.indexOf('-m') + 1]).toMatch(/ggml-base\.en\.bin$/); expect(args[args.indexOf('--prompt') + 1]).toHaveLength('An English learning conversation about: '.length + 500);
  });
  it('keeps recognition unavailable when no model exists and never fetches in status', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('Unexpected network')); const voice = await service();
    expect(await voice.status()).toMatchObject({ recognitionReady: false, synthesisReady: true }); expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });
  it('surfaces unavailable OS voice and preserves the usable text path', async () => {
    vi.mocked(getOfflineVoices).mockRejectedValue(Error('No English voice installed')); const voice = await service();
    expect(await voice.status()).toMatchObject({ synthesisReady: false, error: 'No English voice installed' }); expect(await voice.synthesize('Hello')).toBeNull();
  });
  it('rejects arbitrary model IDs before any download', async () => { const voice = await service(); await expect(voice.installModel('https://evil.invalid/model')).rejects.toThrow(/Unknown voice model|Windows x64/); });
  it('cancels old synthesis and never returns stale PCM', async () => {
    const voice = await service(); await voice.status(); const pending = voice.synthesize('This is fresh narration.');
    await vi.waitFor(() => expect(vi.mocked(getOfflineVoices)).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 50)); voice.cancel();
    await expect(pending).rejects.toThrow(/cancel/i);
  });
  it.runIf(process.platform === 'win32' && process.arch === 'x64')('uses the injected network client for the pinned runtime download without touching Node fetch', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('Node fetch must not be used'));
    const nativeFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    const voice = await service({ fetch: nativeFetch });
    await voice.status(); expect(nativeFetch).not.toHaveBeenCalled();
    await expect(voice.installModel('whisper-tiny-en')).rejects.toThrow('Voice download failed (HTTP 503)');
    expect(nativeFetch).toHaveBeenCalledExactlyOnceWith(WHISPER_RUNTIME.url, expect.objectContaining({ redirect: 'follow', signal: expect.any(AbortSignal) }));
    expect(globalFetch).not.toHaveBeenCalled();
    expect(await voice.status()).toMatchObject({ recognitionReady: false, error: 'Voice download failed (HTTP 503)' });
  });
  it.runIf(process.platform === 'win32' && process.arch === 'x64')('uses the injected network client for weights when the pinned runtime is already verified', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('Node fetch must not be used'));
    const files = new Set(RUNTIME_FILES.map(file => file.filename));
    vi.spyOn(ModelManager.prototype, 'verify').mockImplementation(async artifact => files.has(artifact.filename));
    const nativeFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    const voice = await service({ fetch: nativeFetch });
    await voice.status(); expect(nativeFetch).not.toHaveBeenCalled();
    await expect(voice.installModel('whisper-tiny-en')).rejects.toThrow('Voice download failed (HTTP 503)');
    expect(nativeFetch).toHaveBeenCalledExactlyOnceWith(RECOGNITION_MODELS[0].url, expect.objectContaining({ redirect: 'follow', signal: expect.any(AbortSignal) }));
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
