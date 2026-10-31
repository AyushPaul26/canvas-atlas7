import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ModelManager, RECOGNITION_MODELS, RUNTIME_FILES, WHISPER_RUNTIME } from '../src/models.js';
import { decodePcmWav, validateRecognitionWav } from '../src/recognition.js';
import { segmentNarration } from '../src/synthesis.js';
import { KOKORO_MODEL, KOKORO_FILES, verifyNeuralModel } from '../src/neural-model.js';
import { runLocalProcess } from '../../../apps/desktop/src/main/voice/process.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }))); });
async function root() { const base = join(process.cwd(), '.voice-test-tmp'); await mkdir(base, { recursive: true }); const p = await mkdtemp(join(base, 'fixture-')); roots.push(p); return p; }
const bytes = Buffer.from('small verified fixture');
const artifact = { id: 'fixture', filename: 'fixture.bin', url: 'https://example.invalid/fixture', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };

describe('verified explicit model installation', () => {
  it('ships the exact same pinned metadata in the release manifest', async () => {
    const manifest = JSON.parse(await readFile(join(process.cwd(), 'resources/models/manifest.json'), 'utf8'));
    expect(manifest.engine.archive).toEqual(WHISPER_RUNTIME); expect(manifest.engine.files).toEqual(RUNTIME_FILES);
    for (const model of RECOGNITION_MODELS) expect(manifest.models.find((m: { id: string }) => m.id === model.id)).toMatchObject(model);
    expect(manifest.synthesis.model).toMatchObject(KOKORO_MODEL); expect(KOKORO_FILES).toHaveLength(manifest.synthesis.model.verifiedFileCount);
    expect(KOKORO_FILES.some(file => file.path === 'model.onnx')).toBe(true); expect(KOKORO_FILES.some(file => file.path === 'espeak-ng-data/phontab')).toBe(true);
  });
  it('does not claim neural readiness for absent weights or incomplete phonemizer files', async () => {
    expect(await verifyNeuralModel(await root())).toBe(false);
  });
  it('reports missing without accessing the network', async () => {
    const manager = new ModelManager(await root(), () => { throw Error('network must not run'); });
    expect(await manager.verify(artifact)).toBe(false);
  });
  it('only promotes a complete hash verified download and emits byte progress', async () => {
    const directory = await root(); const progress: number[] = [];
    const manager = new ModelManager(directory, async () => new Response(bytes));
    await manager.install(artifact, p => progress.push(p));
    expect(await manager.verify(artifact)).toBe(true);
    expect(await readFile(join(directory, artifact.filename))).toEqual(bytes);
    expect(progress.at(-1)).toBe(1);
  });
  it('rejects hash mismatch and never installs the bad artifact', async () => {
    const directory = await root(); const manager = new ModelManager(directory, async () => new Response(Buffer.alloc(bytes.length)));
    await expect(manager.install(artifact)).rejects.toThrow(/SHA-256/);
    expect(await manager.verify(artifact)).toBe(false);
    await expect(readFile(join(directory, artifact.filename))).rejects.toThrow();
  });
  it('detects a formerly installed file that was corrupted', async () => {
    const directory = await root(); const manager = new ModelManager(directory, async () => new Response(bytes));
    await manager.install(artifact); await writeFile(join(directory, artifact.filename), Buffer.alloc(bytes.length));
    expect(await manager.verify(artifact)).toBe(false);
  });
  it('does not promote interrupted downloads', async () => {
    const directory = await root(); const abort = new AbortController(); abort.abort();
    const manager = new ModelManager(directory, async () => new Response(bytes));
    await expect(manager.install(artifact, undefined, abort.signal)).rejects.toThrow();
    expect(await manager.verify(artifact)).toBe(false);
  });
});

function wav(seconds = 0.1, rate = 16000) {
  const b = Buffer.alloc(44 + Math.round(seconds * rate) * 2); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40); return b;
}
describe('bounded local audio', () => {
  it('accepts mono 16k PCM and returns exact PCM duration', () => {
    const input = wav(); expect(() => validateRecognitionWav(input)).not.toThrow();
    const output = decodePcmWav(input); expect(output.samples.length / output.sampleRate).toBe(0.1);
  });
  it('rejects malformed, overlong and wrong sample-rate input', () => {
    expect(() => validateRecognitionWav(Buffer.from('not audio'))).toThrow();
    expect(() => validateRecognitionWav(wav(30.1))).toThrow(/30/);
    expect(() => validateRecognitionWav(wav(0.1, 44100))).toThrow(/16000/);
  });
  it('segments fresh narration at 600 characters and removes markup from speech', () => {
    const segments = segmentNarration(('**Gravity** makes things fall. $x^2$ grows. ').repeat(100));
    expect(segments.length).toBeGreaterThan(1); expect(segments.every(s => s.length <= 600)).toBe(true);
    expect(segments.join(' ')).not.toContain('$'); expect(segments.join(' ')).not.toContain('**');
  });
});
describe('trusted bounded child processes', () => {
  it('rejects local process spawn failure', async () => { await expect(runLocalProcess('definitely-no-such-voice-exe', [])).rejects.toThrow(); });
  it('rejects process errors and oversized output', async () => {
    await expect(runLocalProcess(process.execPath, ['-e', 'process.exit(7)'])).rejects.toThrow(/7/);
    await expect(runLocalProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(5000))'], { maxOutputBytes: 128 })).rejects.toThrow(/limit/);
  });
  it('kills an active synthesis process on cancellation', async () => {
    const abort = new AbortController(); const job = runLocalProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: abort.signal }); abort.abort();
    await expect(job).rejects.toThrow(/cancel/i);
  });
});
