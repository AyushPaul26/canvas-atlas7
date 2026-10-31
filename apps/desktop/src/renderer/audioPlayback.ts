import type { AudioResult, NarrationChunk, PlaybackCursor } from '@living-canvas/protocol';

export type AudioFrame = {
  cursor: PlaybackCursor; offsetSeconds: number; durationSeconds: number;
  progress: number; estimated: boolean; restarted?: boolean;
};
export type AudioCallbacks = { onFrame?: (frame: AudioFrame) => void; onHeard?: (text: string) => void };
export interface AudioPlayback {
  play(chunk: NarrationChunk, cursor: PlaybackCursor, callbacks?: AudioCallbacks): Promise<AudioResult>;
  prefetch?(chunk: NarrationChunk): void;
  buffer?(operation: () => Promise<void>): Promise<void>;
  pause(): Promise<AudioResult>;
  resume(): Promise<AudioResult>;
  stop(): void;
}
export const clampVoiceRate = (value: number): number => Number.isFinite(value) ? Math.min(1.25, Math.max(.75, value)) : .96;
type PCM = { samples: Float32Array; sampleRate: number };
type Prepared = { pcm: PCM | null; error?: unknown };
type Options = {
  synthesize: (text: string, signal?: AbortSignal) => Promise<PCM | null>;
  enabled?: () => boolean;
  rate?: () => number;
  onActivity?: (playing: boolean, preparing: boolean, estimated: boolean) => void;
  onError?: (message: string) => void;
};
type Active = {
  chunk: NarrationChunk; cursor: PlaybackCursor; callbacks: AudioCallbacks;
  paused: boolean; context?: AudioContext; source?: AudioBufferSourceNode;
  timer?: ReturnType<typeof setInterval>; duration: number; startTime: number;
  utterance?: SpeechSynthesisUtterance; utteranceEpoch: number; restarted: boolean;
  prepared?: Prepared; ended?: boolean; resolve?: (value: AudioResult) => void;
  buffering?: number; bufferSuspension?: Promise<void>; startTask?: Promise<void>;
  preparation?: AbortController;
};

/** One live source and at most one speculative synthesis. No clock represents unheard audio. */
export function createAudioPlayback(options: Options): AudioPlayback {
  let active: Active | undefined;
  let prefetched: { text: string; promise: Promise<Prepared>; controller: AbortController } | undefined;
  const enabled = () => options.enabled?.() !== false;
  const prepare = (text: string, controller: AbortController): Promise<Prepared> => options.synthesize(text, controller.signal).then(pcm => ({ pcm }), error => ({ pcm: null, error }));
  const current = (value: Active) => active === value;
  const settle = (value: Active, result: AudioResult) => { const resolve = value.resolve; value.resolve = undefined; resolve?.(result); };
  const activity = (playing: boolean, preparing = false, estimated = false) => options.onActivity?.(playing, preparing, estimated);
  const frame = (value: Active, offset: number, ended = false) => {
    if (!current(value) || value.paused || value.buffering) return;
    // End cues belong to a real engine completion, including when fallback pacing underestimates speech.
    const seconds = Math.min(ended ? value.duration : value.duration * .999999, Math.max(0, offset));
    value.callbacks.onFrame?.({ cursor: { ...value.cursor, offsetSeconds: seconds }, offsetSeconds: seconds, durationSeconds: value.duration, progress: value.duration ? seconds / value.duration : 0, estimated: true, ...(value.restarted ? { restarted: true } : {}) });
  };
  const close = (value: Active) => {
    clearInterval(value.timer); value.utteranceEpoch++;
    if (value.utterance) window.speechSynthesis?.cancel();
    if (value.context) { value.context.onstatechange = null; void value.context.close().catch(() => {}); }
  };
  const finish = (value: Active, result: AudioResult) => {
    if (!current(value)) return;
    if (result === 'completed') { value.ended = true; frame(value, value.duration, true); value.callbacks.onHeard?.(value.chunk.text); }
    active = undefined; close(value); activity(false); settle(value, result);
  };
  const fail = (value: Active, error: unknown) => {
    if (!current(value)) return;
    options.onError?.(`Voice playback stopped: ${error instanceof Error ? error.message : String(error)}`);
    finish(value, 'failed');
  };
  const pcmClock = (value: Active) => {
    clearInterval(value.timer);
    if (value.paused || value.buffering || !value.context) return;
    value.timer = setInterval(() => frame(value, value.context!.currentTime - value.startTime), 40);
  };
  const fallback = (value: Active) => {
    const synthesis = window.speechSynthesis;
    const voices = synthesis?.getVoices().filter(v => v.localService && v.lang.startsWith('en')) ?? [];
    const voice = voices.find(v => /female|zira|hazel|heera|samantha|victoria|karen|moira|tessa|fiona|susan|linda|jenny|aria/i.test(v.name)) ?? voices[0];
    if (!voice || typeof SpeechSynthesisUtterance === 'undefined') { finish(value, 'unavailable'); return; }
    const utterance = new SpeechSynthesisUtterance(value.chunk.text), epoch = ++value.utteranceEpoch;
    const rate = clampVoiceRate(options.rate?.() ?? .96);
    value.utterance = utterance; utterance.voice = voice; utterance.rate = rate;
    // Duration is only pacing, never evidence. Completion requires the engine's onend.
    value.duration = Math.max(.8, value.chunk.text.trim().split(/\s+/).length / (2.5 * rate));
    const valid = () => current(value) && !value.paused && epoch === value.utteranceEpoch;
    utterance.onstart = () => {
      if (!valid()) return;
      value.startTime = performance.now(); activity(true, false, true); frame(value, 0);
      value.timer = setInterval(() => { if (valid()) frame(value, (performance.now() - value.startTime) / 1000); }, 40);
    };
    utterance.onend = () => { if (valid()) finish(value, 'completed'); };
    utterance.onerror = event => { if (valid()) fail(value, event.error || 'Local voice failed'); };
    synthesis.speak(utterance);
  };
  const start = async (value: Active) => {
    let startupContext: AudioContext | undefined;
    try {
      if (!value.prepared) {
        value.preparation = prefetched?.text === value.chunk.text ? prefetched.controller : new AbortController();
        const prepared = prefetched?.text === value.chunk.text ? prefetched.promise : prepare(value.chunk.text, value.preparation);
        if (prefetched?.text === value.chunk.text) prefetched = undefined;
        value.prepared = await prepared;
      }
      if (!current(value) || value.paused || value.buffering) return;
      if (!enabled()) { finish(value, 'unavailable'); return; }
      if (value.prepared.error) throw value.prepared.error;
      const pcm = value.prepared.pcm;
      if (!pcm) { fallback(value); return; }
      if (!pcm.samples.length || !Number.isFinite(pcm.sampleRate) || pcm.sampleRate <= 0 || pcm.samples.some(sample => !Number.isFinite(sample))) throw new Error('Voice produced invalid audio');
      const context = new AudioContext(); startupContext = context; value.context = context;
      await context.resume();
      if (!current(value) || value.context !== context) { void context.close().catch(() => {}); return; }
      if (value.paused || value.buffering) { await context.suspend(); return; }
      const buffer = context.createBuffer(1, pcm.samples.length, pcm.sampleRate); buffer.copyToChannel(Float32Array.from(pcm.samples), 0);
      const source = context.createBufferSource(); value.source = source; source.buffer = buffer; source.connect(context.destination);
      const rate = clampVoiceRate(options.rate?.() ?? .96); source.playbackRate.value = rate;
      value.duration = pcm.samples.length / pcm.sampleRate / rate;
      // The source and the clock share AudioContext time, including suspension.
      value.startTime = context.currentTime;
      source.onended = () => {
        if (!current(value)) return;
        value.ended = true;
        if (!value.paused && !value.buffering) finish(value, 'completed');
      };
      context.onstatechange = () => { if (current(value) && context.state === 'closed') finish(value, 'interrupted'); };
      source.start(); activity(true, false, true); frame(value, 0);
      pcmClock(value);
    } catch (error) {
      if (startupContext && value.context !== startupContext) return;
      fail(value, error);
    }
  };
  return {
    play(chunk, cursor, callbacks = {}) {
      const warmed = prefetched?.text === chunk.text ? prefetched : undefined;
      if (warmed) prefetched = undefined;
      this.stop(); prefetched = warmed;
      if (!enabled() || !chunk.text.trim()) { this.stop(); return Promise.resolve('unavailable'); }
      const value: Active = { chunk, cursor: { ...cursor, offsetSeconds: 0 }, callbacks, paused: false, duration: 0, startTime: 0, utteranceEpoch: 0, restarted: false };
      active = value; activity(false, true);
      return new Promise<AudioResult>(resolve => { value.resolve = resolve; value.startTask = start(value); });
    },
    prefetch(chunk) {
      if (!enabled() || prefetched) return;
      const controller = new AbortController();
      prefetched = { text: chunk.text, promise: prepare(chunk.text, controller), controller };
    },
    async buffer(operation) {
      const value = active;
      if (!value || value.ended) { await operation(); return; }
      if (value.utterance) throw new Error('Synchronized visual buffering requires PCM narration. Choose ElevenLabs or the natural local voice and retry.');
      value.buffering = (value.buffering ?? 0) + 1;
      clearInterval(value.timer); activity(false, true, true);
      let resumeFailed = false, resumeError: unknown;
      try {
        if (value.context) {
          value.bufferSuspension ??= value.context.suspend();
          await value.bufferSuspension;
        }
        if (!current(value)) return;
        await operation();
        // Startup may have been waiting on synthesis/context resume when the
        // visual barrier began. Let it reach its buffering guard first.
        if (value.context) await value.startTask;
      } catch (error) {
        fail(value, error); throw error;
      } finally {
        value.buffering--;
        if (!value.buffering) {
          value.bufferSuspension = undefined;
          if (current(value) && !value.paused) {
            if (value.ended) finish(value, 'completed');
            else if (value.context && value.source) {
              try {
                await value.context.resume();
                if (current(value) && !value.paused && !value.buffering) { activity(true, false, true); pcmClock(value); }
                else if (current(value) && value.paused) await value.context.suspend();
              } catch (error) { fail(value, error); resumeFailed = true; resumeError = error; }
            } else {
              if (value.context) { value.context.onstatechange = null; void value.context.close().catch(() => {}); value.context = undefined; }
              if (value.prepared) value.startTask = start(value);
            }
          }
        }
      }
      if (resumeFailed) throw resumeError;
    },
    async pause() {
      const value = active;
      if (!value) return 'paused';
      value.paused = true;
      try {
        if (value.context) await value.context.suspend();
        if (value.utterance) { value.utteranceEpoch++; clearInterval(value.timer); window.speechSynthesis?.cancel(); value.restarted = true; }
        activity(false, false); settle(value, 'paused'); return 'paused';
      } catch (error) { fail(value, error); return 'failed'; }
    },
    resume() {
      const value = active;
      if (!value) return Promise.resolve('unavailable');
      if (!enabled()) { finish(value, 'unavailable'); return Promise.resolve('unavailable'); }
      if (!value.paused) return Promise.resolve('failed');
      value.paused = false;
      return new Promise<AudioResult>(resolve => {
        value.resolve = resolve;
        if (value.buffering) return;
        if (value.ended) {
          // A natural end can arrive while suspend() is still pending. A one-shot
          // source cannot end again; deliver its real terminal event on resume.
          finish(value, 'completed');
        } else if (value.context && value.source) {
          void value.context.resume().then(() => { if (current(value) && !value.paused) { activity(true, false, true); pcmClock(value); } }, error => fail(value, error));
        } else {
          if (value.context) { value.context.onstatechange = null; void value.context.close().catch(() => {}); value.context = undefined; }
          if (value.prepared) value.startTask = start(value);
          // An in-flight preparation already calls start after it resolves.
        }
      });
    },
    stop() {
      const value = active; active = undefined; prefetched?.controller.abort(); prefetched = undefined;
      if (!value) return;
      value.preparation?.abort();
      close(value); activity(false); settle(value, 'interrupted');
    },
  };
}
