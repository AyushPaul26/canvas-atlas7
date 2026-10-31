import { test } from 'node:test'
import assert from 'node:assert/strict'

test('a new teaching beat has validated graphics and no topic registration', async () => {
  const { parseTeachingBeat } = await import('../../packages/protocol/src/index.ts')
  const beat = parseTeachingBeat({ narration: 'An analogy can make a new idea visible.', canvas: { mode: 'replace', entities: [{ id: 'analogy', kind: 'text', x: 20, y: 40, text: 'A new idea' }] } })
  assert.ok(beat.id)
  assert.equal(beat.canvas.entities[0].text, 'A new idea')
  assert.throws(() => parseTeachingBeat({ narration: 'bad', canvas: { mode: 'replace', entities: [{ id: 'bad', kind: 'circle', x: Infinity, y: 0 }] } }))
})

test('a stale teacher patch cannot erase a learner edit', async () => {
  const { SceneStore } = await import('../../packages/scene/src/index.ts')
  const store = new SceneStore()
  store.apply({ mode: 'replace', entities: [{ id: 'a', kind: 'circle', x: 5, y: 5 }] }, 0)
  store.apply({ mode: 'update', entities: [{ id: 'a', kind: 'circle', x: 60, y: 5 }] }, 1)
  assert.throws(() => store.apply({ mode: 'replace', entities: [] }, 1), /revision/i)
  assert.equal(store.snapshot().entities[0].x, 60)
})
