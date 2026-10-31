import { describe, expect, it, vi } from 'vitest';
import { LearningPlanCoordinator } from '../../apps/desktop/src/main/ai/learning-plan-coordinator';
import { SessionRepository } from '../../apps/desktop/src/main/storage/session-repository';

const draft = (title = 'Gravitation') => ({ id: 'draft', version: 1, title, sourceDocumentIds: [], concepts: [
  { id: 'attraction', title: 'Why objects attract', objectives: ['Describe attraction between masses'], prerequisiteIds: [], sourceRefs: [] },
  { id: 'distance', title: 'Mass and distance', objectives: ['Predict inverse-square changes'], prerequisiteIds: ['attraction'], sourceRefs: [] },
] });
const response = (value: unknown) => ({ text: '', output: [], calls: [{ type: 'function_call' as const, namespace: 'planning', name: 'propose_plan', call_id: 'call-plan', arguments: JSON.stringify(value) }] });

describe('topic roadmap planning', () => {
  it('creates an account-generated roadmap without preparing speech or a teaching beat', async () => {
    const store = new SessionRepository(':memory:');
    try {
      const session = store.create('Teach me gravitation');
      const provider = { complete: vi.fn(async (_request: any) => response(draft())) };
      const planner = new LearningPlanCoordinator({ store, provider, model: () => 'selected-astra' });
      const plan = await planner.planTopic({ sessionId: session.id });
      expect(plan.id).not.toBe('draft');
      expect(plan.concepts.map(concept => concept.id)).toEqual(['attraction', 'distance']);
      expect(store.load(session.id).beats).toEqual([]);
      expect(store.load(session.id).messages).toEqual([]);
      expect(store.loadPlan(session.id)).toEqual(plan);
      expect(provider.complete.mock.calls).toHaveLength(1);
      const request = provider.complete.mock.calls[0][0] as any;
      expect(request.model).toBe('selected-astra');
      expect(request.tools[0]).toMatchObject({ type: 'namespace', name: 'planning' });
      expect(request.input[0].content).toContain('Teach me gravitation');
    } finally { store.close(); }
  });

  it('uses the actual provider plan for each subject instead of a fixed roadmap', async () => {
    const store = new SessionRepository(':memory:');
    try {
      const provider = { complete: vi.fn(async (request: any) => response(draft(request.input[0].content.includes('sorting') ? 'Sorting algorithms' : 'Gravitation'))) };
      const planner = new LearningPlanCoordinator({ store, provider, model: () => 'selected' });
      const physics = await planner.planTopic({ sessionId: store.create('gravitation').id });
      const computing = await planner.planTopic({ sessionId: store.create('sorting').id });
      expect(physics.title).toBe('Gravitation'); expect(computing.title).toBe('Sorting algorithms');
    } finally { store.close(); }
  });

  it('rejects unavailable models and prevents canceled model output from saving a roadmap', async () => {
    const store = new SessionRepository(':memory:');
    try {
      const session = store.create('gravity');
      const unavailable = new LearningPlanCoordinator({ store, provider: { complete: vi.fn() }, model: () => undefined });
      await expect(unavailable.planTopic({ sessionId: session.id })).rejects.toThrow(/model/i);
      let resolve!: (value: ReturnType<typeof response>) => void;
      const planner = new LearningPlanCoordinator({ store, provider: { complete: () => new Promise(done => { resolve = done; }) }, model: () => 'selected' });
      const pending = planner.planTopic({ sessionId: session.id });
      planner.cancelAll(); resolve(response(draft()));
      await expect(pending).rejects.toThrow(/cancel|abort/i);
      expect(store.loadPlan(session.id)).toBeUndefined();
    } finally { store.close(); }
  });

  it('repairs malformed output only within the bounded repair allowance', async () => {
    const store = new SessionRepository(':memory:');
    try {
      const provider = { complete: vi.fn(async () => response({ ...draft(), concepts: [] })) };
      const planner = new LearningPlanCoordinator({ store, provider, model: () => 'selected' });
      await expect(planner.planTopic({ sessionId: store.create('gravity').id })).rejects.toThrow(/plan|roadmap/i);
      expect(provider.complete).toHaveBeenCalledTimes(3);
    } finally { store.close(); }
  });
});
