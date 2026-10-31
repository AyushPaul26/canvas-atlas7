import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionRepository } from '../../apps/desktop/src/main/storage/session-repository';
import { SimulationRuntime } from '../../packages/simulation/src/index';
import type { SimulationInput, SimulationCheckpoint } from '../../packages/protocol/src/index';

const harness = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, value: unknown) => Promise<any>>() }));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: any) => harness.handlers.set(name, handler), removeHandler: (name: string) => harness.handlers.delete(name) }, dialog: {} }));
import { registerIpc } from '../../apps/desktop/src/main/ipc-router';

afterEach(() => harness.handlers.clear());

describe('complete simulation and persistence envelopes', () => {
  it.each([
    ['wide', 'new Array(99990).fill(0)'],
    ['deep', 'Array.from({length:31}).reduce(value=>({child:value}),0)']
  ])('saves and replays accepted %s guest state without reducing its complexity allowance', async (_name, expression) => {
    const store = new SessionRepository(':memory:');
    const runtime = await SimulationRuntime.create();
    const lesson = store.create('Complex state');
    const frame = {};
    const window = { webContents: { mainFrame: frame, send: vi.fn() }, isDestroyed: () => false };
    const artifact = { id: 'complex', title: 'Complex state', source: `globalThis.simulation={init(){return ${expression}},step(s){return s},input(s){return s},render(){return{entities:[]}}}`, controls: [], assumptions: [], validation: 'illustrative' as const };
    const router = registerIpc({ window, store, models: { list: [] }, auth: { status: () => ({ connected: false }) }, provider: {}, coordinator: {}, voice: {}, runSimulation: async (input: SimulationInput) => input.replay ? runtime.replay(input.runId, input.artifact.source, {}, { tick: 0, inputs: [] }) : runtime.load(input.runId, input.artifact.source, {}) } as any);
    const invoke = (name: string, value: unknown) => harness.handlers.get(`lc:${name}`)!({ sender: window.webContents, senderFrame: frame }, value);
    try {
      const initial = await invoke('runSimulation', { runId: 'complex', artifact, action: 'init', tick: 0 });
      const checkpoint = { artifact, state: initial.state, tick: 0, values: {}, initialValues: {}, inputs: [] };
      await invoke('saveScene', { sessionId: lesson.id, scene: [], simulation: checkpoint });
      const saved = store.load(lesson.id).simulation!;
      const restored = await invoke('runSimulation', { runId: 'restored', artifact, action: 'init', tick: 0, replay: saved });
      expect(restored.state).toEqual(initial.state);
    } finally { router.dispose(); runtime.dispose(); store.close(); }
  });

  it('advances, saves and replays an accepted large state together with its source', async () => {
    const store = new SessionRepository(':memory:');
    const runtime = await SimulationRuntime.create();
    const lesson = store.create('Large but bounded experiment');
    const frame = {};
    const window = { webContents: { mainFrame: frame, send: vi.fn() }, isDestroyed: () => false };
    const artifact = { id: 'large', title: 'Large state', source: 'globalThis.simulation={init(){return{data:"x".repeat(1900000),tick:0}},step(s,t){s.tick=t;return s},input(s){return s},render(){return{entities:[]}}};/*' + 'x'.repeat(250000) + '*/', controls: [], assumptions: [], validation: 'illustrative' as const };
    const router = registerIpc({ window, store, models: { list: [] }, auth: { status: () => ({ connected: false }) }, provider: {}, coordinator: {}, voice: {}, runSimulation: async (input: SimulationInput) => input.action === 'init' ? input.replay ? runtime.replay(input.runId, input.artifact.source, input.replay.initialValues!, { tick: input.replay.tick, inputs: input.replay.inputs! }) : runtime.load(input.runId, input.artifact.source, {}) : runtime.step(input.runId) } as any);
    const invoke = (name: string, value: unknown) => harness.handlers.get(`lc:${name}`)!({ sender: window.webContents, senderFrame: frame }, value);
    try {
      await invoke('runSimulation', { runId: 'live', artifact, action: 'init', tick: 0 });
      const advanced = await invoke('runSimulation', { runId: 'live', artifact, action: 'step', tick: 0 });
      const checkpoint: SimulationCheckpoint = { artifact, state: advanced.state, tick: 1, values: {}, initialValues: {}, inputs: [] };
      await invoke('saveScene', { sessionId: lesson.id, scene: advanced.entities, controls: {}, simulation: checkpoint });
      const saved = store.load(lesson.id).simulation!;
      expect((saved.state as any).data).toHaveLength(1900000);
      const restored = await invoke('runSimulation', { runId: 'restored', artifact, action: 'init', tick: saved.tick, replay: saved });
      expect(restored.state).toEqual(advanced.state);
    } finally { router.dispose(); runtime.dispose(); store.close(); }
  });

  it('rejects a UTF-8 oversized scene even if its character count is small', async () => {
    const frame = {};
    const window = { webContents: { mainFrame: frame, send: vi.fn() }, isDestroyed: () => false };
    const store = { getPreference: () => undefined, load: () => ({ scene: [], controls: {} }), saveScene: vi.fn() };
    const router = registerIpc({ window, store, models: { list: [] }, auth: { status: () => ({ connected: false }) }, provider: {}, coordinator: {}, voice: {} } as any);
    try {
      const scene = Array.from({ length: 600 }, (_, index) => ({ id: `e${index}`, kind: 'text', x: 0, y: 0, text: '文'.repeat(2000) }));
      await expect(harness.handlers.get('lc:saveScene')!({ sender: window.webContents, senderFrame: frame }, { sessionId: 'lesson', scene })).rejects.toThrow(/size|limit|large/i);
      expect(store.saveScene).not.toHaveBeenCalled();
    } finally { router.dispose(); }
  });
});
