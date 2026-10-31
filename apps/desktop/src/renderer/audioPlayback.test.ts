// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAudioPlayback } from './audioPlayback';

const contexts: FakeContext[] = [];
class FakeContext {
  state = 'running'; destination = {}; time = 0; onstatechange?: () => void;
  source = { buffer: null, playbackRate: { value: 1 }, connect() {}, start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
  constructor() { contexts.push(this); }
  get currentTime() { return this.time; }
  resume = async () => { this.state = 'running'; };
  suspend = async () => { this.state = 'suspended'; };
  close = async () => { this.state = 'closed'; this.onstatechange?.(); };
  createBuffer() { if (this.state === 'closed') throw new Error('Cannot use closed context'); return { copyToChannel() {} }; }
  createBufferSource() { return this.source; }
}
const chunk = { id: 'chunk:1', text: 'First spoken chunk.' };
const cursor = { beatId: 'beat:1', chunkId: chunk.id, offsetSeconds: 0, passId: 'pass:1' };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => { contexts.length = 0; vi.useFakeTimers(); vi.stubGlobal('AudioContext', FakeContext); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('suspends live PCM and resumes the same source without acknowledging paused audio', async () => {
  const heard = vi.fn(), frames: number[] = [];
  const audio = createAudioPlayback({ synthesize: async () => ({ samples: new Float32Array(16000), sampleRate: 8000 }) });
  const first = audio.play(chunk, cursor, { onHeard: heard, onFrame: frame => frames.push(frame.offsetSeconds) });
  await flush(); const context = contexts.at(-1)!; context.time = .75; await vi.advanceTimersByTimeAsync(50);
  expect(frames.at(-1)).toBe(.75);
  await audio.pause(); expect(await first).toBe('paused');
  expect(context.state).toBe('suspended'); expect(heard).not.toHaveBeenCalled();
  const continued = audio.resume(); await flush();
  expect(context.source.start).toHaveBeenCalledTimes(1);
  context.time = 2; context.source.onended?.();
  expect(await continued).toBe('completed'); expect(heard).toHaveBeenCalledWith(chunk.text);
});

it('settles a pending synthesis immediately on stop and rejects late callbacks', async () => {
  let resolve!: (value: { samples: Float32Array; sampleRate: number }) => void;
  const audio = createAudioPlayback({ synthesize: () => new Promise(r => { resolve = r; }) });
  const heard = vi.fn(), frame = vi.fn();
  const result = audio.play(chunk, cursor, { onHeard: heard, onFrame: frame });
  audio.stop(); expect(await result).toBe('interrupted');
  resolve({ samples: new Float32Array(8000), sampleRate: 8000 }); await flush();
  expect(heard).not.toHaveBeenCalled(); expect(frame).not.toHaveBeenCalled();
});

it('remembers a real PCM end event delivered while asynchronous suspension is pending', async () => {
  const heard = vi.fn(), progress: number[] = [];
  const audio = createAudioPlayback({ synthesize: async () => ({ samples: new Float32Array(16000), sampleRate: 8000 }) });
  const first = audio.play(chunk, cursor, { onHeard: heard, onFrame: frame => progress.push(frame.progress) });
  await flush(); const context = contexts.at(-1)!;
  let suspended!: () => void;
  context.suspend = () => new Promise<void>(resolve => { suspended = () => { context.state = 'suspended'; resolve(); }; });
  const pause = audio.pause();
  context.time = 2; context.source.onended?.();
  suspended(); await pause; expect(await first).toBe('paused');
  expect(heard).not.toHaveBeenCalled(); expect(progress).not.toContain(1);
  let resumed: string | undefined;
  void audio.resume().then(result => { resumed = result; }); await flush();
  expect(resumed).toBe('completed');
  expect(progress.filter(value => value === 1)).toHaveLength(1);
  expect(heard).toHaveBeenCalledTimes(1); expect(context.source.start).toHaveBeenCalledTimes(1);
});

it('ignores a superseded context startup when its pending resume resolves after a fresh source starts', async () => {
  let releaseFirst!: () => void;
  vi.stubGlobal('AudioContext', class extends FakeContext {
    resume = () => contexts.indexOf(this) === 0 ? new Promise<void>(resolve => { releaseFirst = resolve; }) : Promise.resolve();
  });
  const audio = createAudioPlayback({ synthesize: async () => ({ samples: new Float32Array(16000), sampleRate: 8000 }) });
  const first = audio.play(chunk, cursor); await flush();
  await audio.pause(); expect(await first).toBe('paused');
  let outcome: string | undefined;
  const resumed = audio.resume().then(result => { outcome = result; return result; }); await flush();
  expect(contexts).toHaveLength(2); expect(contexts[0].state).toBe('closed'); expect(contexts[1].source.start).toHaveBeenCalledTimes(1);
  releaseFirst(); await flush();
  expect(outcome).toBeUndefined(); expect(contexts[1].state).toBe('running');
  contexts[1].source.onended?.(); expect(await resumed).toBe('completed');
});

it('does not invent a playback clock when synthesis and local speech are unavailable', async () => {
  const audio = createAudioPlayback({ synthesize: async () => null });
  const frame = vi.fn(), heard = vi.fn();
  expect(await audio.play(chunk, cursor, { onFrame: frame, onHeard: heard })).toBe('unavailable');
  await vi.advanceTimersByTimeAsync(10000);
  expect(frame).not.toHaveBeenCalled(); expect(heard).not.toHaveBeenCalled();
});

it('buffers PCM behind visual work without settling playback or emitting frozen frames', async () => {
  const frames: number[] = [], audio = createAudioPlayback({ synthesize: async () => ({ samples: new Float32Array(16000), sampleRate: 8000 }) });
  let outcome: string | undefined, release!: () => void;
  const work = new Promise<void>(resolve => { release = resolve; });
  void audio.play(chunk, cursor, { onFrame: frame => frames.push(frame.progress) }).then(result => { outcome = result; });
  await flush(); const context = contexts.at(-1)!;
  const buffered = audio.buffer!(() => work); await flush();
  expect(context.state).toBe('suspended'); const count = frames.length;
  await vi.advanceTimersByTimeAsync(500); expect(frames).toHaveLength(count); expect(outcome).toBeUndefined();
  release(); await buffered; expect(context.state).toBe('running');
  context.time = 2; context.source.onended?.(); await flush();
  expect(outcome).toBe('completed'); expect(context.source.start).toHaveBeenCalledTimes(1);
});

it.each(['pause', 'stop'] as const)('does not automatically resume PCM when the user requests %s during buffering', async action => {
  const audio = createAudioPlayback({ synthesize: async () => ({ samples: new Float32Array(16000), sampleRate: 8000 }) });
  let release!: () => void;
  const first = audio.play(chunk, cursor); await flush(); const context = contexts.at(-1)!;
  const buffered = audio.buffer!(() => new Promise<void>(resolve => { release = resolve; })); await flush();
  if (action === 'pause') await audio.pause(); else audio.stop();
  expect(await first).toBe(action === 'pause' ? 'paused' : 'interrupted');
  release(); await buffered;
  expect(context.state).toBe(action === 'pause' ? 'suspended' : 'closed');
  if (action === 'pause') { const resumed = audio.resume(); await flush(); context.source.onended?.(); expect(await resumed).toBe('completed'); }
});

it('retains genuine PCM completion during buffering until visual work finishes', async () => {
  const heard = vi.fn(), audio = createAudioPlayback({ synthesize: async () => ({ samples: new Float32Array(16000), sampleRate: 8000 }) });
  let release!: () => void;
  const first = audio.play(chunk, cursor, { onHeard: heard }); await flush(); const context = contexts.at(-1)!;
  const buffered = audio.buffer!(() => new Promise<void>(resolve => { release = resolve; })); await flush();
  context.source.onended?.(); expect(heard).not.toHaveBeenCalled();
  release(); await buffered; expect(await first).toBe('completed'); expect(heard).toHaveBeenCalledTimes(1);
});

it('runs terminal-frame visual work even when its callback starts buffering at the actual PCM end', async () => {
  const audio = createAudioPlayback({ synthesize: async () => ({ samples: new Float32Array(16000), sampleRate: 8000 }) });
  let terminalWork: Promise<void> | undefined, applied = false;
  const first = audio.play(chunk, cursor, { onFrame: frame => { if (frame.progress === 1) terminalWork = audio.buffer!(async () => { applied = true; }); } });
  await flush(); contexts.at(-1)!.source.onended?.(); await first; await terminalWork;
  expect(applied).toBe(true);
});

it('fails playback when buffered visual work rejects instead of resuming behind a broken visual', async () => {
  const audio = createAudioPlayback({ synthesize: async () => ({ samples: new Float32Array(16000), sampleRate: 8000 }) });
  const first = audio.play(chunk, cursor); await flush(); const context = contexts.at(-1)!;
  await expect(audio.buffer!(async () => { throw new Error('Simulation failed'); })).rejects.toThrow('Simulation failed');
  expect(await first).toBe('failed'); expect(context.state).toBe('closed');
});

it('awaits preparation work when no audio is active', async () => {
  const audio = createAudioPlayback({ synthesize: async () => null });
  let release!: () => void, complete = false;
  const buffered = audio.buffer!(() => new Promise<void>(resolve => { release = resolve; })).then(() => { complete = true; });
  await flush(); expect(complete).toBe(false); release(); await buffered; expect(complete).toBe(true); expect(contexts).toHaveLength(0);
});

it('does not wait for pending synthesis after visual preparation has finished', async () => {
  let synthesized!: (pcm: { samples: Float32Array; sampleRate: number }) => void;
  const audio = createAudioPlayback({ synthesize: () => new Promise(resolve => { synthesized = resolve; }) });
  const first = audio.play(chunk, cursor); let buffered = false;
  void audio.buffer!(async () => {}).then(() => { buffered = true; }); await flush();
  expect(buffered).toBe(true); expect(contexts).toHaveLength(0);
  synthesized({ samples: new Float32Array(16000), sampleRate: 8000 }); await flush();
  expect(contexts).toHaveLength(1); contexts[0].source.onended?.(); expect(await first).toBe('completed');
});

it('uses bounded local speed for PCM duration and the resumable audio cursor', async () => {
  const frames: Array<{ durationSeconds: number; progress: number; offsetSeconds: number }> = [];
  const audio = createAudioPlayback({ synthesize: async () => ({ samples: new Float32Array(16000), sampleRate: 8000 }), rate: () => 3 });
  const first = audio.play(chunk, cursor, { onFrame: frame => frames.push(frame) }); await flush();
  const context = contexts.at(-1)!;
  expect(context.source.playbackRate.value).toBe(1.25);
  context.time = .8; await vi.advanceTimersByTimeAsync(40);
  expect(frames.at(-1)).toEqual(expect.objectContaining({ durationSeconds: 1.6, offsetSeconds: .8, progress: .5 }));
  await audio.pause(); expect(await first).toBe('paused');
  const resumed = audio.resume(); await flush(); context.time = 1.2; await vi.advanceTimersByTimeAsync(40);
  expect(frames.at(-1)?.progress).toBeCloseTo(.75); expect(context.source.start).toHaveBeenCalledTimes(1);
  context.source.onended?.(); expect(await resumed).toBe('completed');
});

it('rejects unsupported native voice buffering with an actionable error before running visual work', async () => {
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ localService: true, lang: 'en-US', name: 'Zira' }], cancel() {}, speak() {} });
  const operation = vi.fn(), audio = createAudioPlayback({ synthesize: async () => null });
  const first = audio.play(chunk, cursor); await flush();
  await expect(audio.buffer!(operation)).rejects.toThrow(/Kokoro|PCM/);
  expect(operation).not.toHaveBeenCalled(); audio.stop(); expect(await first).toBe('interrupted');
});

it('uses the bounded speed for the native utterance and its estimated pacing', async () => {
  const utterances: Array<{ rate: number; onstart?: () => void; onend?: () => void }> = [];
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ localService: true, lang: 'en-US', name: 'Zira' }], cancel() {}, speak: (u: typeof utterances[number]) => utterances.push(u) });
  const frames: number[] = [], audio = createAudioPlayback({ synthesize: async () => null, rate: () => .1 });
  const first = audio.play(chunk, cursor, { onFrame: frame => frames.push(frame.durationSeconds) }); await flush();
  expect(utterances[0].rate).toBe(.75); utterances[0].onstart?.();
  expect(frames[0]).toBe(1.6); utterances[0].onend?.(); expect(await first).toBe('completed');
});

it('does not start the fallback clock until the actual utterance starts and restarts its chunk on resume', async () => {
  const utterances: Array<{ onstart?: () => void; onend?: () => void; onerror?: () => void }> = [];
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ localService: true, lang: 'en-US', name: 'Zira' }], cancel() {}, speak: (u: typeof utterances[number]) => utterances.push(u) });
  const frames: Array<{ restarted?: boolean; progress: number }> = [], heard = vi.fn();
  const audio = createAudioPlayback({ synthesize: async () => null });
  const first = audio.play(chunk, cursor, { onFrame: f => frames.push(f), onHeard: heard });
  await flush(); await vi.advanceTimersByTimeAsync(5000); expect(frames).toHaveLength(0);
  utterances[0].onstart?.(); expect(frames).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(frames.at(-1)?.progress).toBeLessThan(1); expect(heard).not.toHaveBeenCalled();
  await audio.pause(); expect(await first).toBe('paused');
  const next = audio.resume(); await flush(); utterances[1].onstart?.();
  expect(frames.at(-1)?.restarted).toBe(true);
  utterances[0].onend?.(); expect(heard).not.toHaveBeenCalled();
  utterances[1].onend?.(); expect(await next).toBe('completed');
});
