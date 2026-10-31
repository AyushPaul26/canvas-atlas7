import { useCallback, useEffect, useRef, useState } from 'react';
import { adaptTeachingBeat } from '@living-canvas/protocol';
import type { AdaptedTeachingBeat, AudioResult, NarrationChunk, PlaybackCheckpoint, PlaybackCursor, PresentationReceipt, SceneEntity, SimulationCheckpoint, TeachingBeat, VisualCue } from '@living-canvas/protocol';
import type { AudioFrame, AudioPlayback } from './audioPlayback';

export type PlaybackStatus = 'ready' | 'preparing' | 'playing' | 'paused' | 'failed' | 'completed';
export type LessonPlaybackFrame = AudioFrame & { chunk: NarrationChunk };
export type LessonPlaybackOptions = {
  audio: AudioPlayback;
  onPrepare?: (beat: AdaptedTeachingBeat, mode: 'prepare' | 'resume' | 'replay') => void | Promise<void>;
  onFrame?: (frame: LessonPlaybackFrame) => void | Promise<void>;
  onCue?: (cue: VisualCue, frame: LessonPlaybackFrame) => void | Promise<void>;
  onHeard?: (prefix: string, cursor: PlaybackCursor) => void;
  onCheckpoint?: (checkpoint: PlaybackCheckpoint) => void | Promise<void>;
  onComplete?: (receipt: PresentationReceipt) => void | Promise<void>;
  onError?: (message: string) => void;
  getVisibleScene?: () => SceneEntity[];
  getSimulationCheckpoint?: () => SimulationCheckpoint | undefined;
};
export type PreparePlaybackOptions = {
  baselineScene: SceneEntity[]; checkpoint?: PlaybackCheckpoint; planId?: string; planVersion?: number; mode?: 'prepare' | 'resume' | 'replay';
};
type Prepared = {
  beat: AdaptedTeachingBeat; settings: PreparePlaybackOptions; checkpoint: PlaybackCheckpoint;
  preparationMode: 'prepare' | 'resume' | 'replay'; restartHandled?: boolean;
  audioFrame?: LessonPlaybackFrame; pendingAudio?: { chunkId: string; terminal: LessonPlaybackFrame };
  terminalVisualChunkId?: string;
};
const passId = () => `pass:${crypto.randomUUID()}`;
const clone = <T,>(value: T): T => structuredClone(value);
function rearmIncompleteCues(value: Pick<Prepared, 'beat' | 'checkpoint'>) {
  const completed = new Set(value.checkpoint.completedChunkIds);
  const retained = new Set(value.beat.cues.filter(cue => completed.has(cue.chunkId)).map(cue => cue.id));
  value.checkpoint.appliedCueIds = value.checkpoint.appliedCueIds.filter(id => retained.has(id));
}

/** Coordinates accepted content only. Model requests and renderer effects belong to the caller. */
export function useLessonPlayback(options: LessonPlaybackOptions) {
  const callbacks = useRef(options); callbacks.current = options;
  const [status, setStatus] = useState<PlaybackStatus>('ready');
  const [cursor, setCursor] = useState<PlaybackCursor>();
  const [checkpoint, setCheckpoint] = useState<PlaybackCheckpoint>();
  const [error, setError] = useState<string>();
  const prepared = useRef<Prepared | undefined>(undefined);
  const ready = useRef(false);
  const completedPass = useRef<string | undefined>(undefined);
  const retryingPreparation = useRef<Promise<AudioResult> | undefined>(undefined);
  const epoch = useRef(0), paused = useRef(false), suspended = useRef(false);
  const running = useRef<Promise<AudioResult> | undefined>(undefined);
  const frameWork = useRef<Promise<void>>(Promise.resolve());
  const latestFrame = useRef<LessonPlaybackFrame | undefined>(undefined);
  const frameBusy = useRef(false);
  const visualFailure = useRef<unknown>(undefined);

  const updateCursor = useCallback((value: PlaybackCursor) => {
    if (prepared.current) prepared.current.checkpoint.cursor = value;
    setCursor({ ...value });
  }, []);
  const reportFailure = useCallback((cause: unknown): AudioResult => {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(message); setStatus('failed'); callbacks.current.onError?.(message); return 'failed';
  }, []);
  const snapshot = useCallback(async () => {
    const value = prepared.current;
    if (!value) return;
    const cp = value.checkpoint;
    const visible = callbacks.current.getVisibleScene?.();
    if (visible) cp.visibleScene = clone(visible);
    const simulation = callbacks.current.getSimulationCheckpoint?.();
    if (simulation) cp.simulation = clone(simulation); else if (callbacks.current.getSimulationCheckpoint) delete cp.simulation;
    const saved = clone(cp); setCheckpoint(saved);
    await callbacks.current.onCheckpoint?.(saved);
  }, []);
  const applyFrame = useCallback(async (frame: LessonPlaybackFrame, generation: number) => {
    const value = prepared.current;
    if (!value || generation !== epoch.current || paused.current) return;
    // Cursor/pass identity comes from this presentation, never from an audio callback.
    const actual = { ...frame, cursor: { ...value.checkpoint.cursor, chunkId: frame.chunk.id, offsetSeconds: frame.offsetSeconds } };
    updateCursor(actual.cursor);
    await callbacks.current.onFrame?.(actual);
    if (generation !== epoch.current || paused.current || visualFailure.current) return;
    for (const cue of value.beat.cues) {
      if (cue.chunkId !== frame.chunk.id || value.checkpoint.appliedCueIds.includes(cue.id)) continue;
      const threshold = cue.at === 'start' ? 0 : cue.at === 'end' ? 1 : cue.at;
      if (frame.progress < threshold) continue;
      if (!callbacks.current.onCue) throw new Error('Visual cue renderer is unavailable. Retry after the visual is ready.');
      await callbacks.current.onCue(cue, actual);
      if (generation !== epoch.current) return;
      value.checkpoint.appliedCueIds.push(cue.id);
      if (paused.current) return;
    }
    if (frame.progress === 1) value.terminalVisualChunkId = frame.chunk.id;
  }, [updateCursor]);
  const enqueueFrame = useCallback((frame: LessonPlaybackFrame, generation: number) => {
    if (generation !== epoch.current || paused.current || visualFailure.current) return;
    latestFrame.current = frame;
    if (frameBusy.current) return;
    frameBusy.current = true;
    frameWork.current = (async () => {
      while (latestFrame.current && generation === epoch.current && !paused.current) {
        const next = latestFrame.current; latestFrame.current = undefined;
        await applyFrame(next, generation);
      }
    })().catch(cause => {
      if (generation === epoch.current) { visualFailure.current = cause; callbacks.current.audio.stop(); }
      throw cause;
    }).finally(() => { frameBusy.current = false; });
    // Keep a rejected visual callback handled until the presentation loop awaits it.
    void frameWork.current.catch(() => {});
  }, [applyFrame]);

  const prepare = useCallback(async (beat: TeachingBeat, settings: PreparePlaybackOptions) => {
    const generation = ++epoch.current; ready.current = false; retryingPreparation.current = undefined; callbacks.current.audio.stop();
    paused.current = false; suspended.current = false; latestFrame.current = undefined;
    await running.current; await frameWork.current.catch(() => {});
    if (generation !== epoch.current) return;
    frameBusy.current = false; frameWork.current = Promise.resolve(); visualFailure.current = undefined; setError(undefined); setStatus('preparing');
    const accepted = clone(adaptTeachingBeat(beat));
    const restored = settings.checkpoint;
    if (restored && restored.cursor.beatId !== beat.id) { reportFailure('Playback checkpoint belongs to another teaching step.'); return; }
    const nextCursor = { beatId: beat.id, chunkId: accepted.chunks.find(c => !restored?.completedChunkIds.includes(c.id))?.id ?? accepted.chunks.at(-1)!.id, offsetSeconds: 0, passId: passId() };
    // After restart an incomplete chunk explicitly replays from its beginning.
    const cp: PlaybackCheckpoint = restored ? { ...clone(restored), cursor: nextCursor } : { cursor: nextCursor, completedChunkIds: [], appliedCueIds: [], baselineScene: clone(settings.baselineScene), visibleScene: clone(settings.baselineScene) };
    if (restored) rearmIncompleteCues({ beat: accepted, checkpoint: cp });
    delete cp.receipt;
    const preparationMode = settings.mode ?? (restored ? 'resume' : 'prepare');
    prepared.current = { beat: accepted, settings: { ...settings, checkpoint: undefined }, checkpoint: cp, preparationMode };
    setCheckpoint(clone(cp)); updateCursor(nextCursor);
    try {
      await callbacks.current.onPrepare?.(accepted, preparationMode);
      if (generation === epoch.current) { ready.current = true; setStatus('ready'); }
    } catch (cause) { if (generation === epoch.current) reportFailure(cause); }
  }, [reportFailure, updateCursor]);

  const run = useCallback((resuming: boolean): Promise<AudioResult> => {
    if (running.current) return running.current;
    const value = prepared.current;
    if (!value || !ready.current) return Promise.resolve('unavailable');
    if (completedPass.current === value.checkpoint.cursor.passId) return Promise.resolve('completed');
    const generation = epoch.current;
    value.restartHandled = false;
    visualFailure.current = undefined; frameWork.current = Promise.resolve();
    paused.current = false; setError(undefined); setStatus('playing');
    const operation = (async (): Promise<AudioResult> => {
      try {
        for (const [index, chunk] of value.beat.chunks.entries()) {
          if (generation !== epoch.current) return 'interrupted';
          if (paused.current) { setStatus('paused'); await snapshot(); return 'paused'; }
          if (value.checkpoint.completedChunkIds.includes(chunk.id)) continue;
          const ended = value.pendingAudio?.chunkId === chunk.id;
          if (!ended && !(resuming && suspended.current)) rearmIncompleteCues(value);
          updateCursor({ ...value.checkpoint.cursor, chunkId: chunk.id, offsetSeconds: resuming && suspended.current ? value.checkpoint.cursor.offsetSeconds : 0 });
          // Start cues are visual readiness barriers. They never acknowledge speech.
          for (const cue of value.beat.cues.filter(c => c.chunkId === chunk.id && (c.at === 'start' || c.at === 0) && !value.checkpoint.appliedCueIds.includes(c.id))) {
            if (!callbacks.current.onCue) throw new Error('Visual cue renderer is unavailable.');
            await callbacks.current.onCue(cue, { chunk, cursor: value.checkpoint.cursor, offsetSeconds: 0, durationSeconds: 0, progress: 0, estimated: true });
            if (generation !== epoch.current) return 'interrupted';
            value.checkpoint.appliedCueIds.push(cue.id);
            if (paused.current) { setStatus('paused'); await snapshot(); return 'paused'; }
          }
          let prefetched = false;
          const next = value.beat.chunks[index + 1];
          if (!ended && !(resuming && suspended.current)) { value.audioFrame = undefined; value.terminalVisualChunkId = undefined; }
          const result: AudioResult = ended ? 'completed' : await (resuming && suspended.current ? callbacks.current.audio.resume() : callbacks.current.audio.play(chunk, value.checkpoint.cursor, {
            onFrame: frame => {
              if (generation !== epoch.current || paused.current) return;
              if (frame.restarted && frame.offsetSeconds === 0 && !value.restartHandled) {
                value.restartHandled = true; rearmIncompleteCues(value); value.terminalVisualChunkId = undefined;
              }
              value.audioFrame = { ...frame, chunk };
              if (!prefetched && next) { prefetched = true; callbacks.current.audio.prefetch?.(next); }
              enqueueFrame({ ...frame, chunk }, generation);
            },
          }));
          if (generation !== epoch.current) return 'interrupted';
          suspended.current = result === 'paused'; resuming = false;
          if (result === 'completed' && !ended) {
            const last = value.audioFrame;
            const duration = last?.durationSeconds ?? 0;
            value.pendingAudio = { chunkId: chunk.id, terminal: { chunk, cursor: { ...value.checkpoint.cursor, offsetSeconds: duration }, offsetSeconds: duration, durationSeconds: duration, progress: 1, estimated: true } };
          }
          await frameWork.current;
          if (generation !== epoch.current) return 'interrupted';
          if (visualFailure.current) throw visualFailure.current;
          if (paused.current) { setStatus('paused'); await snapshot(); return 'paused'; }
          if (result !== 'completed') {
            setStatus(result === 'paused' || result === 'interrupted' ? 'paused' : 'failed');
            if (result === 'failed' || result === 'unavailable') setError(result === 'unavailable' ? 'Voice is disabled or unavailable. Enable a local voice and retry.' : 'Voice playback failed. Retry this chunk.');
            await snapshot(); return result;
          }
          // Audio completion and terminal visual completion are independent.
          // A pause may have discarded/coalesced the queued terminal frame;
          // keep the genuine audio result and finish only its visual work.
          if (value.terminalVisualChunkId !== chunk.id && value.pendingAudio) {
            await applyFrame(value.pendingAudio.terminal, generation);
            if (generation !== epoch.current) return 'interrupted';
            if (paused.current) { setStatus('paused'); await snapshot(); return 'paused'; }
          }
          // Completion is the only evidence that the whole chunk was actually heard.
          value.checkpoint.completedChunkIds.push(chunk.id);
          value.pendingAudio = undefined;
          callbacks.current.onHeard?.(value.beat.chunks.slice(0, index + 1).map(c => c.text).join(''), { ...value.checkpoint.cursor });
          await snapshot();
        }
        if (generation !== epoch.current) return 'interrupted';
        if (paused.current) { setStatus('paused'); return 'paused'; }
        const visualComplete = value.beat.cues.every(c => value.checkpoint.appliedCueIds.includes(c.id));
        if (!visualComplete) throw new Error('The visual presentation did not finish. Retry this teaching step.');
        const receipt: PresentationReceipt = { beatId: value.beat.id, planId: value.settings.planId ?? 'legacy', planVersion: value.settings.planVersion ?? 1, passId: value.checkpoint.cursor.passId, completedChunkIds: [...value.checkpoint.completedChunkIds], appliedCueIds: [...value.checkpoint.appliedCueIds], audioResult: 'completed', visualComplete };
        value.checkpoint.receipt = receipt;
        await snapshot();
        if (generation !== epoch.current) return 'interrupted';
        if (paused.current) { setStatus('paused'); return 'paused'; }
        await callbacks.current.onComplete?.(receipt);
        if (generation !== epoch.current) return 'interrupted';
        completedPass.current = receipt.passId;
        setStatus('completed'); return 'completed';
      } catch (cause) {
        if (generation !== epoch.current) return 'interrupted';
        callbacks.current.audio.stop(); suspended.current = false; return reportFailure(cause);
      }
    })();
    running.current = operation;
    void operation.finally(() => { if (running.current === operation) running.current = undefined; });
    return operation;
  }, [applyFrame, enqueueFrame, reportFailure, snapshot, updateCursor]);

  const play = useCallback(() => run(false), [run]);
  const pause = useCallback(async (): Promise<AudioResult> => {
    paused.current = true; latestFrame.current = undefined; setStatus('paused');
    const result = await callbacks.current.audio.pause();
    const operation = running.current;
    if (operation) return operation;
    try { await snapshot(); return result; } catch (cause) { return reportFailure(cause); }
  }, [reportFailure, snapshot]);
  const resume = useCallback(async (): Promise<AudioResult> => {
    await running.current;
    const value = prepared.current;
    if (!value || ready.current) return run(true);
    if (retryingPreparation.current) return retryingPreparation.current;
    const generation = epoch.current;
    paused.current = false; setError(undefined); setStatus('preparing');
    const operation = (async (): Promise<AudioResult> => {
      try {
        await callbacks.current.onPrepare?.(value.beat, value.preparationMode);
        if (generation !== epoch.current) return 'interrupted';
        ready.current = true;
        if (paused.current) { setStatus('paused'); return 'paused'; }
        return run(true);
      } catch (cause) { return generation === epoch.current ? reportFailure(cause) : 'interrupted'; }
    })();
    retryingPreparation.current = operation;
    void operation.finally(() => { if (retryingPreparation.current === operation) retryingPreparation.current = undefined; });
    return operation;
  }, [reportFailure, run]);
  const interrupt = useCallback(async (): Promise<AudioResult> => {
    epoch.current++; paused.current = true; suspended.current = false; latestFrame.current = undefined; callbacks.current.audio.stop();
    if (prepared.current) prepared.current.pendingAudio = undefined;
    await running.current; await frameWork.current.catch(() => {}); setStatus('paused');
    try { await snapshot(); return 'interrupted'; } catch (cause) { return reportFailure(cause); }
  }, [reportFailure, snapshot]);
  const replay = useCallback(async (): Promise<AudioResult> => {
    const value = prepared.current;
    if (!value) return 'unavailable';
    await prepare(value.beat, { ...value.settings, baselineScene: value.checkpoint.baselineScene, mode: 'replay' });
    // Replay uses the immutable accepted beat and a fresh presentation pass.
    return run(false);
  }, [prepare, run]);
  useEffect(() => () => { epoch.current++; callbacks.current.audio.stop(); }, []);
  return { status, cursor, checkpoint, error, prepare, play, pause, resume, replay, interrupt, stop: interrupt };
}
