import { expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createVoiceService } from '../../../apps/desktop/src/main/voice/voice-worker-manager.js';

it.runIf(process.platform === 'win32' && process.env.LIVING_CANVAS_VOICE_TRIAL === '1')('produces real local English PCM using installed Windows SAPI without downloading anything', async () => {
  const base = join(process.cwd(), '.voice-test-tmp'); await mkdir(base, { recursive: true });
  const modelDirectory = await mkdtemp(join(base, 'real-sapi-')); const voice = createVoiceService({ modelDirectory });
  try {
    const status = await voice.status(); expect(status.recognitionReady).toBe(false); expect(status.synthesisReady, status.error).toBe(true);
    const voices = await voice.voices(); expect(voices.length).toBeGreaterThan(0);
    const start = performance.now();
    const pcm = await voice.synthesize('Gravity bends the path. The square root of nine is three.');
    expect(pcm).not.toBeNull(); expect(pcm!.sampleRate).toBe(24000); expect(pcm!.samples.length).toBeGreaterThan(24000);
    expect(pcm!.samples.some(v => Math.abs(v) > 0.01)).toBe(true);
    const synthesisMs = Math.round(performance.now() - start); const durationSeconds = pcm!.samples.length / pcm!.sampleRate;
    const measurement = { engine: 'Windows SAPI', voice: voices[0].name, synthesisMs, durationSeconds, realTimeFactor: synthesisMs / 1000 / durationSeconds, sampleRate: pcm!.sampleRate, sampleCount: pcm!.samples.length, note: 'Single generated English PCM trial; excludes initial voice probing, includes per-job PowerShell startup. No speaker output or microphone measurement.' };
    console.info(JSON.stringify(measurement));
    if (process.env.LIVING_CANVAS_VOICE_METRICS === '1') await writeFile(join(process.cwd(), 'docs', 'voice-trial.json'), JSON.stringify(measurement, null, 2) + '\n');
  } finally { voice.dispose(); await rm(modelDirectory, { recursive: true, force: true }); }
}, 30000);
