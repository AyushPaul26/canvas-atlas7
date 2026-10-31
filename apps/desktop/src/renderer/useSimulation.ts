import { useCallback, useEffect, useRef, useState } from 'react';
import { LIMITS, controlSchema } from '@living-canvas/protocol';
import type { SceneEntity, SimulationArtifact, SimulationCheckpoint } from '@living-canvas/protocol';
import { bridge, type Values } from './bridge';

export function useSimulation(onError: (error: string) => void) {
  const [artifact, setArtifact] = useState<SimulationArtifact | null>(null);
  const [entities, setEntities] = useState<SceneEntity[]>([]);
  const [measurements, setMeasurements] = useState<Record<string, number | string>>({});
  const [frameState, setFrameState] = useState<unknown>();
  const [generation, setGeneration] = useState(0);
  const [values, setValues] = useState<Values>({});
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const runtime = useRef<{ runId: string; artifact: SimulationArtifact; state: unknown; tick: number; values: Values; committedValues: Values; epoch: number; initialValues: Values; inputs: Array<{ tick: number; values: Values }>; replay?: SimulationCheckpoint; entityIds: Map<string, string> } | null>(null);
  const epochRef = useRef(0);
  const playEpoch = useRef(0);
  const inFlight = useRef(false);
  const ready = useRef(false);
  const timelineControlled = useRef(false);
  const advancing = useRef(false);
  const pendingValues = useRef<Values | null>(null);
  const lastEntities = useRef<SceneEntity[]>([]);
  const onErrorRef = useRef(onError); onErrorRef.current = onError;

  const invoke = useCallback(async (action: 'init' | 'step' | 'input') => {
    const active = runtime.current;
    if (!active || inFlight.current) return false;
    inFlight.current = true;
    try {
      if ((action === 'step' && active.tick >= 36000) || (action === 'input' && active.inputs.length >= 1000)) throw new Error('This experiment reached its saved playback limit. Reset it to keep exploring.');
      const appliedValues = { ...(action === 'input' ? active.values : active.committedValues) };
      if (action === 'input' && new TextEncoder().encode(JSON.stringify([...active.inputs, { tick: active.tick, values: appliedValues }])).byteLength > LIMITS.inputHistoryBytes) throw new Error('This experiment reached its saved input history limit. Reset it to keep exploring.');
      const result = await bridge.runSimulation({ runId: active.runId, artifact: active.artifact, tick: active.tick, values: appliedValues, action, dt: 1 / 60, ...(action === 'init' && active.replay ? { replay: active.replay } : {}) });
      if (active.epoch !== epochRef.current) return false;
      if (result.error) throw new Error(result.error);
      active.state = result.state;
      if (action === 'step') active.tick++;
      if (action === 'input') { active.inputs.push({ tick: active.tick, values: appliedValues }); active.committedValues = appliedValues; }
      const frame = result.entities.map((entity) => {
        if (active.entityIds.size >= 10000 && !active.entityIds.has(entity.id)) throw new Error('This experiment created too many changing objects. Reset it to continue.');
        if (!active.entityIds.has(entity.id)) active.entityIds.set(entity.id, `sim:${active.runId}:${active.entityIds.size}`);
        return { ...entity, id: active.entityIds.get(entity.id)! };
      });
      lastEntities.current = frame; setEntities(frame); setMeasurements(result.measurements ?? {}); setFrameState(result.state);
      return true;
    } catch (error) {
      if (action === 'input' && !pendingValues.current && active.epoch === epochRef.current) { active.values = { ...active.committedValues }; setValues(active.values); }
      if (active.epoch === epochRef.current) { setRunning(false); onErrorRef.current(`Experiment paused: ${error instanceof Error ? error.message : String(error)}`); }
      return false;
    } finally { inFlight.current = false; }
  }, []);

  const start = useCallback(async (next: SimulationArtifact, saved: Values = {}, checkpoint?: SimulationCheckpoint, autoPlay = false) => {
    const epoch = ++epochRef.current;
    const playToken = ++playEpoch.current;
    pendingValues.current = null;
    ready.current = false;
    setRunning(false); setBusy(true); setEntities([]); lastEntities.current = []; setMeasurements({}); setFrameState(undefined); setGeneration(epoch); setArtifact(next);
    const initial = Object.fromEntries(next.controls.map((control) => [control.id, checkpoint?.values[control.id] ?? saved[control.id] ?? control.value]));
    setValues(initial);
    runtime.current = { runId: crypto.randomUUID(), artifact: next, state: undefined, tick: checkpoint?.tick ?? 0, values: initial, committedValues: { ...initial }, epoch, initialValues: checkpoint?.initialValues ?? { ...initial }, inputs: checkpoint?.inputs ? [...checkpoint.inputs] : [], replay: checkpoint, entityIds: new Map() };
    // A previous call may still be resolving; it cannot overwrite this generation.
    while (inFlight.current && epoch === epochRef.current) await new Promise((resolve) => setTimeout(resolve, 15));
    if (epoch !== epochRef.current) return false;
    const initialized = await invoke('init');
    if (epoch !== epochRef.current) return false;
    ready.current = initialized;
    setBusy(false); if (initialized && autoPlay && !timelineControlled.current && playEpoch.current === playToken) setRunning(true);
    return initialized;
  }, [invoke]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { if (!timelineControlled.current) void invoke('step'); }, 1000 / 60);
    return () => clearInterval(timer);
  }, [running, invoke]);

  const change = useCallback((id: string, value: number | string | boolean) => {
    const active = runtime.current; if (!active) return;
    const control = active.artifact.controls.find(item => item.id === id);
    if (!control || !controlSchema.safeParse({ ...control, value }).success) { onErrorRef.current('Experiment paused: This value is outside the control range.'); return; }
    active.values = { ...active.values, [id]: value }; setValues(active.values); pendingValues.current = active.values;
    const update = async () => {
      if (!runtime.current || active.epoch !== epochRef.current) return;
      if (inFlight.current) { setTimeout(() => void update(), 15); return; }
      if (!pendingValues.current) return;
      active.values = pendingValues.current; pendingValues.current = null;
      await invoke('input');
    };
    void update();
  }, [invoke]);

  const changeManyAsync = useCallback(async (changes: Values): Promise<boolean> => {
    const active = runtime.current;
    if (!active || !ready.current || !Object.keys(changes).length) return false;
    for (const [id, value] of Object.entries(changes)) {
      const control = active.artifact.controls.find(item => item.id === id);
      if (!control || !controlSchema.safeParse({ ...control, value }).success) return false;
    }
    while ((inFlight.current || pendingValues.current) && active.epoch === epochRef.current) await new Promise(resolve => setTimeout(resolve, 15));
    if (active.epoch !== epochRef.current) return false;
    active.values = { ...active.committedValues, ...changes }; setValues(active.values);
    return invoke('input');
  }, [invoke]);
  const changeAsync = useCallback((id: string, value: number | string | boolean) => changeManyAsync({ [id]: value }), [changeManyAsync]);

  /** A single bounded slice. The audio owner buffers/pauses and retries when false is returned. */
  const advanceTo = useCallback(async (targetTick: number, maxSteps = 12): Promise<boolean> => {
    const active = runtime.current;
    if (!active || !ready.current || !Number.isInteger(targetTick) || targetTick < active.tick || targetTick > 36000 || inFlight.current || pendingValues.current || advancing.current) return false;
    timelineControlled.current = true; playEpoch.current++; setRunning(false);
    advancing.current = true;
    try {
      const budget = Math.max(1, Math.min(12, Math.floor(Number.isFinite(maxSteps) ? maxSteps : 12)));
      const started = performance.now();
      for (let steps = 0; active.tick < targetTick && steps < budget; steps++) {
        if (active.epoch !== epochRef.current || !await invoke('step')) return false;
        if (performance.now() - started >= 32) break;
      }
      return active.epoch === epochRef.current && active.tick === targetTick;
    } finally { advancing.current = false; }
  }, [invoke]);
  const setTimelineControlled = useCallback((controlled: boolean) => {
    timelineControlled.current = controlled;
    if (controlled) { playEpoch.current++; setRunning(false); }
  }, []);

  const clear = useCallback(() => { epochRef.current++; playEpoch.current++; ready.current = false; runtime.current = null; pendingValues.current = null; lastEntities.current = []; setRunning(false); setBusy(false); setArtifact(null); setEntities([]); setValues({}); setMeasurements({}); setFrameState(undefined); }, []);
  useEffect(() => () => { epochRef.current++; runtime.current = null; pendingValues.current = null; }, []);
  const checkpoint = (): SimulationCheckpoint | undefined => {
    const active = runtime.current;
    return active ? { artifact: active.artifact, state: active.state, tick: active.tick, values: { ...active.committedValues }, initialValues: { ...active.initialValues }, inputs: active.inputs.map((input) => ({ tick: input.tick, values: { ...input.values } })) } : undefined;
  };
  const settle = async () => { while (inFlight.current || pendingValues.current) await new Promise((resolve) => setTimeout(resolve, 15)); };
  return { artifact, entities, measurements, frameState, generation, values, running, busy, start, change, changeAsync, changeManyAsync, advanceTo, setTimelineControlled, clear, checkpoint, settle, visible: () => lastEntities.current, pause: () => { playEpoch.current++; setRunning(false); }, toggle: () => { playEpoch.current++; if (!timelineControlled.current && ready.current) setRunning((value) => !value); }, reset: () => artifact && void start(artifact, values), resetAsync: () => artifact ? start(artifact, values) : Promise.resolve(false) };
}
