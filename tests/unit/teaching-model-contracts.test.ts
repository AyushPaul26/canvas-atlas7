import { describe, expect, it } from 'vitest'
import { parseTeachingBeat, simulationArtifactSchema } from '../../packages/protocol/src/index'

const model = { version: 1, kind: 'math', bounds: { left: -5, right: 5, bottom: -5, top: 5 }, points: [{ id: 'p', x: 1, y: 2 }], plots: [], vectors: [] }
const artifact = { id: 'explore', title: 'Coordinates', source: JSON.stringify(model), controls: [], assumptions: ['Coordinates on a plane'], validation: 'illustrative' }

describe('trusted teaching model admission', () => {
  it('admits a data-only math engine while preserving legacy artifacts', () => {
    expect(simulationArtifactSchema.parse({ ...artifact, engine: 'model' }).engine).toBe('model')
    expect(simulationArtifactSchema.parse(artifact).engine).toBeUndefined()
  })
  it('rejects executable model strings, excessive JSON and unknown kinds', () => {
    for (const source of ['globalThis.simulation = {}', JSON.stringify({ ...model, kind: 'remote' }), ' '.repeat(65537)]) {
      expect(simulationArtifactSchema.safeParse({ ...artifact, engine: 'model', source }).success).toBe(false)
    }
  })
  it('normalizes provider optional null engine without changing old simulation behavior', () => {
    const beat = parseTeachingBeat({ narration: 'A point on a plane.', canvas: { mode: 'replace', entities: [] }, simulation: { ...artifact, engine: null } })
    expect(beat.simulation?.engine).toBeUndefined()
  })
})
