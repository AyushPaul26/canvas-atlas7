// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AudioResult, TeachingBeat } from '@living-canvas/protocol';
import type { AudioCallbacks, AudioPlayback } from './audioPlayback';
import { useLessonPlayback } from './useLessonPlayback';
import {evaluateVisualFrame} from '@living-canvas/scene';

afterEach(cleanup);
const beat: TeachingBeat = { id: 'beat:1', narration: 'One. Two.', canvas: { mode: 'replace', entities: [] }, chunks: [{ id: 'a', text: 'One. ' }, { id: 'b', text: 'Two.' }], cues: [{ id: 'cue:a', chunkId: 'a', at: .5, action: { type: 'highlight', targetId: 'thing', active: true } }] };
function device() {
  let finish!: (result: AudioResult) => void;
  let callbacks: AudioCallbacks = {};
  const chunks: string[] = [];
  const audio: AudioPlayback = {
    play(chunk, _cursor, cb = {}) { chunks.push(chunk.id); callbacks = cb; return new Promise(r => { finish = r; }); },
    pause: async () => { finish('paused'); return 'paused'; },
    resume: () => new Promise(r => { finish = r; }),
    stop: () => finish?.('interrupted'),
  };
  const frame = (progress: number, restarted = false) => callbacks.onFrame?.({ cursor: { beatId: 'beat:1', chunkId: chunks.at(-1)!, offsetSeconds: progress * 2, passId: 'fake' }, offsetSeconds: progress * 2, durationSeconds: 2, progress, estimated: true, ...(restarted ? { restarted: true } : {}) });
  return { audio, chunks, finish: (result: AudioResult) => { if (result === 'completed') frame(1); finish(result); }, frame };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const terminalBeat: TeachingBeat = { ...beat, narration: 'One.', chunks: [{ id: 'a', text: 'One.' }], cues: [{ id: 'cue:end', chunkId: 'a', at: 'end', action: { type: 'highlight', targetId: 'thing', active: true } }] };

it('preserves terminal visual work when pause arrives after audio ended behind a pending frame', async () => {
  const d = device(), heard = vi.fn(), cue = vi.fn(), complete = vi.fn();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const { result } = renderHook(() => useLessonPlayback({ audio: d.audio, onHeard: heard, onCue: cue, onComplete: complete, onFrame: frame => frame.progress === .25 ? pending : undefined }));
  await act(() => result.current.prepare(terminalBeat, { baselineScene: [] }));
  let first!: Promise<AudioResult>, pause!: Promise<AudioResult>;
  await act(async () => { first = result.current.play(); await flush(); d.frame(.25); await flush(); d.finish('completed'); await flush(); pause = result.current.pause(); await flush(); release(); await pause; });
  expect(await first).toBe('paused'); expect(heard).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  let outcome: AudioResult | undefined;
  await act(async () => { outcome = await result.current.resume(); });
  expect(outcome).toBe('completed'); expect(d.chunks).toEqual(['a']);
  expect(cue).toHaveBeenCalledWith(expect.objectContaining({ id: 'cue:end' }), expect.objectContaining({ progress: 1 }));
  expect(heard).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
});

it('rejects stale heard and completed-chunk writes when interruption occurs during final visual work', async () => {
  const d = device(), heard = vi.fn(), complete = vi.fn(), checkpoints: Array<{ completedChunkIds: string[] }> = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const { result } = renderHook(() => useLessonPlayback({ audio: d.audio, onHeard: heard, onCue: () => {}, onComplete: complete, onFrame: () => pending, onCheckpoint: cp => { checkpoints.push(cp); } }));
  await act(() => result.current.prepare(terminalBeat, { baselineScene: [] }));
  let first!: Promise<AudioResult>, interrupted!: Promise<AudioResult>;
  await act(async () => { first = result.current.play(); await flush(); d.finish('completed'); await flush(); interrupted = result.current.interrupt(); await flush(); release(); await interrupted; });
  expect(await first).toBe('interrupted'); expect(heard).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  expect(checkpoints).toHaveLength(1); expect(checkpoints[0].completedChunkIds).toEqual([]);
});

it('keeps final completion paused when pause arrives during the receipt checkpoint save', async () => {
  const d = device(), complete = vi.fn();
  let release!: () => void, saving = false;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const { result } = renderHook(() => useLessonPlayback({ audio: d.audio, onCue: () => {}, onComplete: complete, onCheckpoint: cp => { if (cp.receipt && !saving) { saving = true; return pending; } } }));
  await act(() => result.current.prepare(terminalBeat, { baselineScene: [] }));
  let first!: Promise<AudioResult>, pause!: Promise<AudioResult>;
  await act(async () => { first = result.current.play(); await flush(); d.finish('completed'); await flush(); });
  expect(saving).toBe(true);
  await act(async () => { pause = result.current.pause(); await flush(); release(); await pause; });
  expect(await first).toBe('paused'); expect(complete).not.toHaveBeenCalled();
  await act(() => result.current.resume()); expect(complete).toHaveBeenCalledTimes(1); expect(d.chunks).toEqual(['a']);
});

it('pauses audio and cues, preserves the cursor and only completes after resumed audio and visuals', async () => {
  const d = device(), cue = vi.fn(), complete = vi.fn(), heard = vi.fn(), snapshots: unknown[] = [];
  const { result } = renderHook(() => useLessonPlayback({ audio: d.audio, onCue: cue, onComplete: complete, onHeard: heard, onCheckpoint: cp => { snapshots.push(cp); } }));
  await act(() => result.current.prepare(beat, { baselineScene: [], planId: 'plan:1', planVersion: 1 }));
  let first!: Promise<AudioResult>;
  await act(async () => { first = result.current.play(); await flush(); d.frame(.25); await flush(); });
  await act(() => result.current.pause());
  expect(await first).toBe('paused'); expect(result.current.status).toBe('paused'); expect(result.current.cursor?.offsetSeconds).toBe(.5);
  await act(async () => { d.frame(.75); await flush(); }); expect(cue).not.toHaveBeenCalled(); expect(heard).not.toHaveBeenCalled();
  let resumed!: Promise<AudioResult>;
  await act(async () => { resumed = result.current.resume(); await flush(); d.frame(.75); await flush(); d.finish('completed'); await flush(); });
  expect(cue).toHaveBeenCalledTimes(1); expect(complete).not.toHaveBeenCalled(); expect(heard).toHaveBeenCalledWith('One. ', expect.objectContaining({ chunkId: 'a' }));
  await act(async () => { d.finish('completed'); await resumed; });
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ audioResult: 'completed', completedChunkIds: ['a', 'b'], appliedCueIds: ['cue:a'], visualComplete: true }));
  expect(snapshots.length).toBeGreaterThan(1);
});

it.each(['failed', 'unavailable'] as const)('keeps %s audio paused without a receipt or invented heard text', async outcome => {
  const d = device(), complete = vi.fn(), heard = vi.fn();
  const { result } = renderHook(() => useLessonPlayback({ audio: d.audio, onComplete: complete, onHeard: heard }));
  await act(() => result.current.prepare(beat, { baselineScene: [] }));
  let running!: Promise<AudioResult>;
  await act(async () => { running = result.current.play(); await flush(); d.finish(outcome); await running; });
  expect(result.current.status).toBe('failed'); expect(complete).not.toHaveBeenCalled(); expect(heard).not.toHaveBeenCalled();
});

it('does not publish completion when checkpoint storage rejects acknowledged audio', async () => {
  const d = device(), complete = vi.fn();
  const { result } = renderHook(() => useLessonPlayback({ audio: d.audio, onCue: () => {}, onComplete: complete, onCheckpoint: async () => { throw new Error('Disk full'); } }));
  await act(() => result.current.prepare(beat, { baselineScene: [] }));
  let running!: Promise<AudioResult>;
  await act(async () => { running = result.current.play(); await flush(); d.finish('completed'); await running; });
  expect(result.current.status).toBe('failed'); expect(result.current.error).toContain('Disk full'); expect(complete).not.toHaveBeenCalled();
});

it('halts presentation immediately on a visual frame failure without losing that failure to a later frame', async () => {
  const d = device(), complete = vi.fn();
  const { result } = renderHook(() => useLessonPlayback({ audio: d.audio, onComplete: complete, onCue: () => {}, onFrame: async () => { throw new Error('Visual unavailable'); } }));
  await act(() => result.current.prepare(beat, { baselineScene: [] }));
  let running!: Promise<AudioResult>;
  await act(async () => { running = result.current.play(); await flush(); d.frame(.3); await flush(); });
  expect(result.current.status).toBe('failed');
  expect(await running).toBe('failed'); expect(complete).not.toHaveBeenCalled();
});

it('waits for visual readiness and rejects a failed renderer before starting speech', async () => {
  const d = device();
  const { result } = renderHook(() => useLessonPlayback({ audio: d.audio, onPrepare: async () => { throw new Error('Experiment not ready'); } }));
  await act(() => result.current.prepare(beat, { baselineScene: [] }));
  let outcome: AudioResult | undefined;
  await act(async () => { outcome = await result.current.play(); });
  expect(outcome).toBe('unavailable'); expect(d.chunks).toEqual([]); expect(result.current.status).toBe('failed');
});

it('retries failed visual preparation on Resume before allowing accepted audio to start', async () => {
  const d = device(), complete = vi.fn();
  let attempts = 0, release!: () => void;
  const retryReady = new Promise<void>(resolve => { release = resolve; });
  const onPrepare = async () => { attempts++; if (attempts === 1) throw new Error('Temporary experiment startup failure'); await retryReady; };
  const { result } = renderHook(() => useLessonPlayback({ audio: d.audio, onPrepare, onCue: () => {}, onComplete: complete }));
  await act(() => result.current.prepare(terminalBeat, { baselineScene: [] }));
  expect(result.current.status).toBe('failed');
  const originalPass = result.current.cursor?.passId;
  let resumed!: Promise<AudioResult>;
  await act(async () => { resumed = result.current.resume(); await flush(); });
  expect(attempts).toBe(2); expect(d.chunks).toEqual([]); expect(result.current.status).toBe('preparing');
  await act(async () => { release(); await flush(); });
  expect(d.chunks).toEqual(['a']); expect(result.current.cursor?.passId).toBe(originalPass);
  await act(async () => { d.finish('completed'); expect(await resumed).toBe('completed'); });
  expect(complete).toHaveBeenCalledTimes(1);
});

it('rearms an incomplete saved chunks experiment cue after rewind and retains earlier acknowledged cues', async () => {
  const d = device(), complete = vi.fn(); let control = 9;
  const experimentBeat: TeachingBeat = { ...beat, cues: [beat.cues![0], { id: 'cue:b', chunkId: 'b', at: .5, action: { type: 'experiment', controlId: 'mass', value: 2 } }] };
  const applied: string[] = [];
  const { result } = renderHook(() => useLessonPlayback({ audio: d.audio, onPrepare: () => { control = 1; }, onCue: cue => { applied.push(cue.id); if (cue.action.type === 'experiment') control = Number(cue.action.value); }, onComplete: complete }));
  await act(() => result.current.prepare(experimentBeat, { baselineScene: [], checkpoint: { cursor: { beatId: beat.id, chunkId: 'b', offsetSeconds: 1.3, passId: 'old' }, completedChunkIds: ['a'], appliedCueIds: ['cue:a', 'cue:b'], baselineScene: [], visibleScene: [] } }));
  let running!: Promise<AudioResult>;
  await act(async () => { running = result.current.play(); await flush(); d.frame(.25); await flush(); }); expect(control).toBe(1);
  await act(async () => { d.frame(.75); await flush(); }); expect(control).toBe(2); expect(applied).toEqual(['cue:b']);
  await act(async () => { d.finish('completed'); await running; });
  expect(d.chunks).toEqual(['b']);
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ appliedCueIds: ['cue:a', 'cue:b'] }));
});

it('rearms current chunk effects when fallback audio explicitly restarts at zero after Pause', async () => {
  const d = device(); let control = 1;
  const experimentBeat: TeachingBeat = { ...terminalBeat, cues: [{ id: 'cue:control', chunkId: 'a', at: .5, action: { type: 'experiment', controlId: 'mass', value: 2 } }] };
  const applied: string[] = [];
  const { result } = renderHook(() => useLessonPlayback({ audio: d.audio, onFrame: frame => { if (frame.restarted && frame.offsetSeconds === 0) control = 1; }, onCue: cue => { applied.push(cue.id); if (cue.action.type === 'experiment') control = Number(cue.action.value); } }));
  await act(() => result.current.prepare(experimentBeat, { baselineScene: [] }));
  let first!: Promise<AudioResult>;
  await act(async () => { first = result.current.play(); await flush(); d.frame(.75); await flush(); }); expect(control).toBe(2);
  await act(() => result.current.pause()); expect(await first).toBe('paused');
  let resumed!: Promise<AudioResult>;
  await act(async () => { resumed = result.current.resume(); await flush(); d.frame(0, true); await flush(); }); expect(control).toBe(1);
  await act(async () => { d.frame(.75, true); await flush(); }); expect(control).toBe(2); expect(applied).toEqual(['cue:control', 'cue:control']);
  await act(async () => { d.finish('completed'); await resumed; }); expect(d.chunks).toEqual(['a']);
});

it('restarts an incomplete saved chunk at zero while retaining acknowledged earlier chunks', async () => {
  const d = device(), heard = vi.fn();
  const { result } = renderHook(() => useLessonPlayback({ audio: d.audio, onCue: () => {}, onHeard: heard }));
  await act(() => result.current.prepare(beat, { baselineScene: [], checkpoint: { cursor: { beatId: beat.id, chunkId: 'b', offsetSeconds: 1.3, passId: 'old' }, completedChunkIds: ['a'], appliedCueIds: ['cue:a'], baselineScene: [], visibleScene: [] } }));
  expect(result.current.cursor).toEqual(expect.objectContaining({ chunkId: 'b', offsetSeconds: 0 }));
  let running!: Promise<AudioResult>;
  await act(async () => { running = result.current.play(); await flush(); d.finish('completed'); await running; });
  expect(d.chunks).toEqual(['b']); expect(heard).toHaveBeenCalledWith('One. Two.', expect.objectContaining({ chunkId: 'b' }));
});

it('publishes completion only once for an already completed pass', async () => {
  const d = device(), complete = vi.fn();
  const { result } = renderHook(() => useLessonPlayback({ audio: d.audio, onCue: () => {}, onComplete: complete }));
  await act(() => result.current.prepare(beat, { baselineScene: [] }));
  let running!: Promise<AudioResult>;
  await act(async () => { running = result.current.play(); await flush(); d.finish('completed'); await flush(); d.finish('completed'); await running; });
  await act(() => result.current.play());
  expect(complete).toHaveBeenCalledTimes(1);
});

it('replays the same accepted content with a new pass and ignores callbacks from an interrupted pass', async () => {
  const d = device(), complete = vi.fn(), heard = vi.fn();
  const { result } = renderHook(() => useLessonPlayback({ audio: d.audio, onCue: () => {}, onComplete: complete, onHeard: heard }));
  await act(() => result.current.prepare(beat, { baselineScene: [] }));
  let first!: Promise<AudioResult>;
  await act(async () => { first = result.current.play(); await flush(); });
  const oldPass = result.current.cursor?.passId;
  await act(() => result.current.interrupt()); expect(await first).toBe('interrupted');
  await act(async () => { d.frame(1); await flush(); }); expect(heard).not.toHaveBeenCalled();
  let replay!: Promise<AudioResult>;
  await act(async () => { replay = result.current.replay(); await flush(); });
  expect(result.current.cursor?.passId).not.toBe(oldPass); expect(d.chunks).toEqual(['a', 'a']);
  await act(async () => { d.finish('completed'); await flush(); d.finish('completed'); await replay; });
  expect(complete).toHaveBeenCalledTimes(1);
});

it('holds path motion while paused and resumes or replays it from accepted audio frames', async () => {
  const d=device();let pose={x:0,y:0};
  const moving:TeachingBeat={...terminalBeat,canvas:{mode:'replace',entities:[{id:'particle',kind:'circle',x:0,y:0,radius:8}]},cues:[{id:'travel',chunkId:'a',at:'start',action:{type:'path',targetId:'particle',points:[{x:0,y:0},{x:20,y:0},{x:20,y:80}],durationMs:2000}}]};
  const {result}=renderHook(()=>useLessonPlayback({audio:d.audio,onCue:()=>{},onFrame:frame=>{const entity=evaluateVisualFrame(moving,frame,moving.canvas.entities).entities[0];pose={x:entity.x,y:entity.y};}}));
  await act(()=>result.current.prepare(moving,{baselineScene:moving.canvas.entities}));
  let first!:Promise<AudioResult>;
  await act(async()=>{first=result.current.play();await flush();d.frame(.25);await flush();});
  expect(pose).toEqual({x:20,y:5});
  await act(()=>result.current.pause());expect(await first).toBe('paused');
  await act(async()=>{d.frame(.75);await flush();});expect(pose).toEqual({x:20,y:5});
  let resumed!:Promise<AudioResult>;
  await act(async()=>{resumed=result.current.resume();await flush();d.frame(.5);await flush();});expect(pose).toEqual({x:20,y:30});
  await act(async()=>{d.finish('completed');expect(await resumed).toBe('completed');});expect(pose).toEqual({x:20,y:80});
  let replay!:Promise<AudioResult>;
  await act(async()=>{replay=result.current.replay();await flush();d.frame(.25);await flush();});expect(pose).toEqual({x:20,y:5});
  await act(async()=>{d.finish('completed');await replay;});
});
