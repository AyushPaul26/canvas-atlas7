import { describe, expect, it } from 'vitest';
import { LessonCoordinator } from '../../apps/desktop/src/main/ai/lesson-coordinator';
import { SessionRepository } from '../../apps/desktop/src/main/storage/session-repository';
import * as teacher from '../../packages/teacher/src/index';
import type { TutorEvent, LearningPlan, PlaybackCheckpoint } from '@living-canvas/protocol';

const plan: LearningPlan = { id: 'plan', version: 1, title: 'Gravity', sourceDocumentIds: [], concepts: [{ id: 'force', title: 'Attraction', objectives: ['Explain attraction'], prerequisiteIds: [], sourceRefs: [] }] };
describe('durable presentation and concept progress', () => {
  it('requires actual audio and visual receipts before completing a planned concept', async () => {
    const store = new SessionRepository(':memory:'); const session = store.create('gravity'); store.savePlan(session.id, plan);
    const events: TutorEvent[] = [];
    const coordinator = new LessonCoordinator({ store, teacher, model: () => 'model', emit: event => events.push(event), provider: { complete: async () => ({ text: '', output: [], calls: [{ type: 'function_call', namespace: 'teaching', name: 'present_beat', call_id: 'c', arguments: JSON.stringify({ conceptId: 'force', narration: 'Masses attract.', chunks: [{ id: 'sentence', text: 'Masses attract.' }], cues: [], next: 'finish', canvas: { mode: 'replace', entities: [] } }) }] }) } });
    try {
      await coordinator.startConcept({ sessionId: session.id, conceptId: 'force' });
      const event = events.find(event => event.type === 'beat') as Extract<TutorEvent, { type: 'beat' }>;
      const progress = { sessionId: session.id, epoch: event.epoch, beatId: event.beat.id, scene: [], narration: event.beat.narration, complete: true };
      expect(() => coordinator.presentProgress(progress)).toThrow(/audio|receipt|playback/i);
      const checkpoint: PlaybackCheckpoint = { cursor: { beatId: event.beat.id, chunkId: 'sentence', offsetSeconds: 1, passId: 'pass' }, completedChunkIds: ['sentence'], appliedCueIds: [], baselineScene: [], visibleScene: [], receipt: { beatId: event.beat.id, planId: 'plan', planVersion: 1, passId: 'pass', completedChunkIds: ['sentence'], appliedCueIds: [], audioResult: 'failed', visualComplete: true } };
      coordinator.savePlayback({ sessionId: session.id, epoch: event.epoch, checkpoint });
      expect(() => coordinator.presentProgress(progress)).toThrow(/audio|receipt|playback/i);
      checkpoint.receipt!.audioResult = 'completed';
      coordinator.savePlayback({ sessionId: session.id, epoch: event.epoch, checkpoint });
      coordinator.presentProgress(progress);
      expect(store.loadLearningProgress(session.id)?.status).toBe('completed');
      expect(store.load(session.id).messages.filter(message => message.role === 'student')).toHaveLength(1);
    } finally { store.close(); }
  });
});
