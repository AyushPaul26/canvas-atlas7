import { describe, expect, it } from 'vitest'
import { SceneStore } from '../../packages/scene/src/index'

describe('semantic scene', () => {
  it('preserves learner IDs that resemble an experiment namespace', () => {
    const store = new SceneStore(); store.restore([{ id: 'experiment:note', kind: 'text', x: 0, y: 0, text: 'Learner note' }]);
    store.applyFrame('experiment', [{ id: 'note', kind: 'circle', x: 1, y: 1 }]);
    const first = store.snapshot(); expect(first.entities.find(e => e.id === 'experiment:note')?.text).toBe('Learner note'); expect(first.entities).toHaveLength(2);
    const frameId = first.entities.find(e => e.kind === 'circle')!.id;
    store.applyFrame('experiment', [{ id: 'note', kind: 'circle', x: 3, y: 1 }]);
    expect(store.snapshot().entities.find(e => e.kind === 'circle')?.id).toBe(frameId);
  })
  it('keeps overlapping simulation namespaces isolated', () => {
    const store = new SceneStore(); store.applyFrame('a:b', [{ id: 'point', kind: 'circle', x: 1, y: 1 }]); store.applyFrame('a', [{ id: 'point', kind: 'circle', x: 2, y: 2 }]);
    expect(store.snapshot().entities).toHaveLength(2);
    store.applyFrame('a', []); expect(store.snapshot().entities).toHaveLength(1); expect(store.snapshot().entities[0].x).toBe(1);
  })
  it('rejects over-limit replacement and merged scenes without losing the prior snapshot', () => {
    const store = new SceneStore(); const entities = Array.from({ length: 400 }, (_, i) => ({ id: `a${i}`, kind: 'text' as const, x: 0, y: 0, text: 'x'.repeat(4000) }));
    store.apply({ mode: 'replace', entities }); const before = store.snapshot();
    expect(() => store.apply({ mode: 'append', entities: entities.map(e => ({ ...e, id: `b${e.id}` })) })).toThrow(/size|large|limit/i);
    expect(store.snapshot()).toEqual(before);
    expect(() => store.apply({ mode: 'replace', entities: Array.from({ length: 600 }, (_, i) => ({ ...entities[0], id: `c${i}` })) })).toThrow(/size|large|limit/i);
    expect(store.snapshot()).toEqual(before);
  })
  it('preserves a learner edit when an older teaching patch arrives', () => {
    const store = new SceneStore()
    store.apply({ mode: 'replace', entities: [{ id: 'a', kind: 'circle', x: 10, y: 10 }] }, 0)
    store.apply({ mode: 'update', entities: [{ id: 'a', kind: 'circle', x: 80, y: 10 }] }, 1)
    expect(() => store.apply({ mode: 'replace', entities: [] }, 1)).toThrow(/revision/i)
    expect(store.snapshot().entities[0].x).toBe(80)
  })
  it('does not change the semantic revision for simulation frames', () => {
    const store = new SceneStore()
    store.apply({ mode: 'replace', entities: [{ id: 'note', kind: 'text', x: 0, y: 0, text: 'My question' }] }, 0)
    store.applyFrame('experiment', [{ id: 'ball', kind: 'circle', x: 20, y: 10 }])
    expect(store.snapshot().revision).toBe(1)
    expect(store.snapshot().entities.map(x => x.id)).toEqual(['note', 'experiment:ball'])
  })
})

