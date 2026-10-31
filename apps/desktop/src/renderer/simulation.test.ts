// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulationArtifact, SimulationCheckpoint, SimulationInput, SimulationResult } from '@living-canvas/protocol';

const harness = vi.hoisted(() => ({ run: vi.fn<(input: SimulationInput) => Promise<SimulationResult>>() }));
vi.mock('./bridge', () => ({ bridge: { runSimulation: harness.run } }));
import { useSimulation } from './useSimulation';
const artifact: SimulationArtifact = { id: 'test-program', title: 'Test', source: 'test-only', controls: [{ id: 'speed', type: 'slider', label: 'Speed', value: 1, min: 0, max: 10 }], assumptions: [], validation: 'illustrative' };

beforeEach(() => { harness.run.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('sandbox bridge sequencing', () => {
  it('commits a two-axis graph drag as one checkpointed input and exposes the same returned frame', async () => {
    const xy = { ...artifact, controls: ['x', 'y'].map(id => ({ id, label: id, type: 'number' as const, min: -10, max: 10, value: 0 })) };
    harness.run.mockImplementation(async input => ({ state: { point: input.values }, entities: [] }));
    const { result } = renderHook(() => useSimulation(vi.fn()));
    await act(() => result.current.start(xy));
    await act(async () => { expect(await result.current.changeManyAsync({ x: 3, y: -2 })).toBe(true); });
    expect(harness.run.mock.calls.map(([input]) => input.action)).toEqual(['init', 'input']);
    expect(result.current.checkpoint()?.inputs).toEqual([{ tick: 0, values: { x: 3, y: -2 } }]);
    expect(result.current.frameState).toEqual({ point: { x: 3, y: -2 } });
  });
  it('rejects an entire invalid graph drag without partially changing controls', async () => {
    const xy = { ...artifact, controls: ['x', 'y'].map(id => ({ id, label: id, type: 'number' as const, min: -10, max: 10, value: 0 })) };
    harness.run.mockResolvedValue({ state: {}, entities: [] });
    const { result } = renderHook(() => useSimulation(vi.fn()));
    await act(() => result.current.start(xy));
    await act(async () => { expect(await result.current.changeManyAsync({ x: 3, y: 11 })).toBe(false); });
    expect(result.current.values).toEqual({ x: 0, y: 0 });
    expect(harness.run).toHaveBeenCalledTimes(1);
    expect(result.current.checkpoint()?.inputs).toEqual([]);
  });
  it('never starts playback when initialization fails', async () => {
    harness.run.mockRejectedValue(new Error('Initialization failed'));
    const { result } = renderHook(() => useSimulation(vi.fn()));
    await act(() => result.current.start(artifact, {}, undefined, true));
    expect(result.current.running).toBe(false);
    expect(result.current.busy).toBe(false);
    expect(harness.run).toHaveBeenCalledTimes(1);
  });
  it('discards an old initialization after the active experiment has changed', async () => {
    let resolveOld!: (result: SimulationResult) => void;
    harness.run.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue({ state: { active: true }, entities: [{ id: 'new-object', kind: 'text', x: 0, y: 0 }] });
    const { result } = renderHook(() => useSimulation(vi.fn()));
    let first!: Promise<boolean>;
    act(() => { first = result.current.start(artifact); });
    act(() => result.current.clear());
    let next!: Promise<boolean>;
    act(() => { next = result.current.start({ ...artifact, id: 'new-program' }); });
    await act(async () => { resolveOld({ state: {}, entities: [{ id: 'old-object', kind: 'text', x: 0, y: 0 }] }); await first; await next; });
    expect(result.current.entities).toHaveLength(1);
    expect(result.current.entities[0].id).toMatch(/^sim:[\w-]+:0$/);
  });

  it.each(['reset', 'start', 'clear'] as const)('settles after %s replaces deferred input with queued controls', async (replacement) => {
    vi.useFakeTimers();
    let resolveInput!: (result: SimulationResult) => void;
    harness.run.mockResolvedValueOnce({ state: { version: 'initial' }, entities: [] })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveInput = resolve; }))
      .mockResolvedValue({ state: { version: 'replacement' }, entities: [] });
    const onError = vi.fn();
    const { result } = renderHook(() => useSimulation(onError));
    await act(() => result.current.start(artifact));
    act(() => result.current.change('speed', 4));
    act(() => result.current.change('speed', 9));
    act(() => {
      if (replacement === 'start') void result.current.start({ ...artifact, id: 'replacement' });
      else result.current[replacement]();
    });
    let settled = false;
    act(() => { void result.current.settle().then(() => { settled = true; }); });
    expect(settled).toBe(false);
    await act(async () => {
      resolveInput({ state: { version: 'obsolete' }, entities: [] });
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(settled).toBe(true);
    expect(harness.run.mock.calls.map(([input]) => input.action)).toEqual(replacement === 'clear' ? ['init', 'input'] : ['init', 'input', 'init']);
    expect(result.current.checkpoint()?.inputs ?? []).toEqual([]);
    if (replacement === 'clear') expect(result.current.checkpoint()).toBeUndefined();
    else { expect(result.current.busy).toBe(false); expect(result.current.checkpoint()?.state).toEqual({ version: 'replacement' }); }
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps a large returned state in checkpoints without retransmitting it for live actions', async () => {
    vi.useFakeTimers();
    const largeState = { payload: 's'.repeat(1_900_000) };
    const largeArtifact = { ...artifact, source: 's'.repeat(250_138) };
    harness.run.mockResolvedValue({ state: largeState, entities: [] });
    const { result } = renderHook(() => useSimulation(vi.fn()));
    await act(() => result.current.start(largeArtifact, {}, undefined, true));
    await act(() => vi.advanceTimersByTimeAsync(17));
    act(() => result.current.pause());
    await act(async () => { result.current.change('speed', 4); });
    expect(harness.run.mock.calls.map(([input]) => input.action)).toEqual(['init', 'step', 'input']);
    for (const [input] of harness.run.mock.calls) {
      expect(Object.hasOwn(input, 'state')).toBe(false);
      expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBeLessThan(2 * 1024 * 1024);
    }
    expect(result.current.checkpoint()?.state).toEqual(largeState);
  });

  it('rejects an unrecordable UTF-8 input before dispatch and recovers on a smaller input and reset', async () => {
    vi.useFakeTimers();
    const longValue = '界'.repeat(200);
    const controls = ['first', 'second'].map((id) => ({ id, type: 'select' as const, label: id, value: '', options: ['', 'a', longValue] }));
    const historyArtifact = { ...artifact, controls };
    const committed = { first: '', second: '' };
    // 1,048,336 UTF-8 bytes: a short input still fits, a 200-character CJK value does not.
    const inputs = [...Array.from({ length: 842 }, () => ({ tick: 0, values: { first: longValue, second: longValue } })), { tick: 0, values: committed }];
    const saved: SimulationCheckpoint = { artifact: historyArtifact, state: { applied: '' }, tick: 0, values: committed, initialValues: committed, inputs };
    harness.run.mockImplementation(async (input) => ({ state: { applied: input.values?.first ?? '' }, entities: [] }));
    const onError = vi.fn();
    const { result } = renderHook(() => useSimulation(onError));
    await act(() => result.current.start(historyArtifact, committed, saved, true));
    await act(async () => { result.current.change('first', longValue); });
    expect(harness.run).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Experiment paused:.*history/i));
    expect(result.current.running).toBe(false);
    expect(result.current.values).toEqual(committed);
    expect(result.current.checkpoint()?.inputs).toHaveLength(843);
    expect(result.current.checkpoint()?.state).toEqual({ applied: '' });
    let resolveValidInput!: (result: SimulationResult) => void;
    harness.run.mockImplementationOnce(() => new Promise((resolve) => { resolveValidInput = resolve; }));
    act(() => result.current.change('first', 'a'));
    act(() => result.current.change('first', longValue));
    await act(async () => {
      resolveValidInput({ state: { applied: 'a' }, entities: [] });
      await vi.advanceTimersByTimeAsync(30);
    });
    expect(harness.run).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(result.current.values).toEqual({ first: 'a', second: '' });
    expect(result.current.checkpoint()?.inputs).toHaveLength(844);
    expect(result.current.checkpoint()?.values).toEqual({ first: 'a', second: '' });
    expect(result.current.checkpoint()?.state).toEqual({ applied: 'a' });
    await act(async () => { result.current.change('first', 'a'); });
    expect(result.current.checkpoint()?.inputs).toHaveLength(845);
    act(() => result.current.reset());
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(result.current.checkpoint()?.inputs).toEqual([]);
    expect(result.current.busy).toBe(false);
  });

  it('records successful control inputs at their deterministic tick and restores through init replay', async () => {
    harness.run.mockImplementation(async (input) => ({ state: { tick: input.tick }, entities: [{ id: 'e'.repeat(160), kind: 'circle', x: 1, y: 1 }] }));
    const { result } = renderHook(() => useSimulation(vi.fn()));
    await act(() => result.current.start(artifact));
    const stableId = result.current.entities[0].id;
    expect(stableId.length).toBeLessThan(160);
    act(() => result.current.change('speed', 4));
    await waitFor(() => expect(result.current.checkpoint()?.inputs).toEqual([{ tick: 0, values: { speed: 4 } }]));
    expect(result.current.entities[0].id).toBe(stableId);
    const snapshot = result.current.checkpoint()!;
    expect(snapshot.initialValues).toEqual({ speed: 1 });
    await act(() => result.current.start(artifact, snapshot.values, snapshot));
    expect(harness.run.mock.calls.at(-1)?.[0]).toMatchObject({ action: 'init', replay: snapshot });
  });

  it('keeps the last committed frame when a sandbox call fails', async () => {
    const onError = vi.fn();
    harness.run.mockResolvedValueOnce({ state: {}, entities: [{ id: 'last-good', kind: 'circle', x: 10, y: 10, radius: 5 }] }).mockRejectedValueOnce(new Error('Execution limit reached'));
    const { result } = renderHook(() => useSimulation(onError));
    await act(() => result.current.start(artifact));
    act(() => result.current.change('speed', 9));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Experiment paused: Execution limit reached'));
    expect(result.current.entities[0].id).toMatch(/^sim:[\w-]+:0$/);
    expect(result.current.running).toBe(false);
    expect(result.current.checkpoint()?.inputs).toEqual([]);
    expect(result.current.checkpoint()?.values).toEqual({ speed: 1 });
  });
});

it('returns explicit failed initialization readiness', async () => {
  harness.run.mockRejectedValue(new Error('Init failed'));
  const { result } = renderHook(() => useSimulation(vi.fn()));
  let ready: unknown;
  await act(async () => { ready = await result.current.start(artifact); });
  expect(ready).toBe(false);
});

it('bounds narration stepping and gates free-running exploration', async () => {
  harness.run.mockResolvedValue({ state: {}, entities: [] });
  const { result } = renderHook(() => useSimulation(vi.fn()));
  await act(async () => { expect(await result.current.start(artifact)).toBe(true); });
  act(() => result.current.setTimelineControlled(true));
  act(() => result.current.toggle());
  expect(result.current.running).toBe(false);
  let ready: unknown;
  await act(async () => { ready = await result.current.advanceTo(300); });
  expect(ready).toBe(false); expect(result.current.checkpoint()?.tick).toBe(12);
  await act(async () => { ready = await result.current.advanceTo(15); });
  expect(ready).toBe(true); expect(result.current.checkpoint()?.tick).toBe(15);
  await act(async () => { expect(await result.current.advanceTo(14)).toBe(false); });
  expect(result.current.checkpoint()?.tick).toBe(15);
});

it('awaits validated scripted control application and rejects bad inputs', async () => {
  harness.run.mockImplementation(async input => ({ state: input.values, entities: [] }));
  const { result } = renderHook(() => useSimulation(vi.fn()));
  await act(() => result.current.start(artifact));
  await act(async () => { expect(await result.current.changeAsync('speed', 4)).toBe(true); });
  expect(result.current.checkpoint()?.values.speed).toBe(4);
  await act(async () => { expect(await result.current.changeAsync('speed', 100)).toBe(false); });
  expect(result.current.checkpoint()?.values.speed).toBe(4);
});
