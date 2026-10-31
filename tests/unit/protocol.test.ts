import { describe, expect, it } from 'vitest'
import { LIMITS, parseScene, parseTeachingBeat, sceneEntitySchema, simulationArtifactSchema, simulationCheckpointSchema } from '../../packages/protocol/src/index'

describe('teaching boundary', () => {
  it('normalizes nullable optional tool fields while preserving required-field validation', () => {
    const beat = parseTeachingBeat({ id: null, title: null, question: null, narration: 'Fresh narration', canvas: { mode: 'replace', entities: [{ id: 'a', kind: 'text', x: 0, y: 0, text: 'Visible', points: null, fill: null }] }, simulation: { id: 'm', title: 'Model', source: 'globalThis.simulation={}', controls: [{ id: 'speed', label: 'Speed', type: 'number', value: 1, min: null, max: null, options: null }], assumptions: [], validation: null } });
    expect(beat.title).toBeUndefined(); expect(beat.canvas.entities[0].points).toBeUndefined(); expect(beat.simulation?.controls[0].min).toBeUndefined(); expect(beat.simulation?.validation).toBe('illustrative');
    expect(() => parseTeachingBeat({ narration: null, canvas: { mode: 'replace', entities: [] } })).toThrow();
    expect(() => parseTeachingBeat({ narration: 'Hello', canvas: { mode: 'replace', entities: [] }, unexpected: null })).toThrow();
    expect(() => parseTeachingBeat(JSON.parse('{"narration":"Hello","canvas":{"mode":"replace","entities":[]},"constructor":null}'))).toThrow();
  })
  it('rejects over-limit direct scenes by UTF-8 serialized bytes', () => {
    const entities = Array.from({ length: 600 }, (_, i) => ({ id: `e${i}`, kind: 'text', x: 0, y: 0, text: '文'.repeat(2000) }));
    expect(new TextEncoder().encode(JSON.stringify(entities)).byteLength).toBeGreaterThan(LIMITS.sceneBytes);
    expect(() => parseScene(entities)).toThrow(/size|large|limit/i);
  })
  it('accepts a newly composed topic without any topic registration', () => {
    const beat = parseTeachingBeat({
      narration: 'A suffix changes how a word works.',
      canvas: { mode: 'replace', entities: [{ id: 'root', kind: 'text', x: 20, y: 40, text: 'kind → kindness' }] }
    })
    expect(beat.id).toBeTruthy()
    expect(beat.canvas.entities[0].text).toContain('kindness')
  })
  it('rejects host execution fields and nonfinite coordinates', () => {
    expect(() => sceneEntitySchema.parse({ id: 'bad', kind: 'text', x: Infinity, y: 0, text: 'x' })).toThrow()
    expect(() => parseTeachingBeat({ narration: 'Hello', canvas: { mode: 'replace', entities: [] }, execute: 'process.exit()' })).toThrow()
  })
  it('rejects duplicate entities rather than silently overwriting a drawing', () => {
    expect(() => parseTeachingBeat({ narration: 'Two points', canvas: { mode: 'replace', entities: [
      { id: 'point', kind: 'circle', x: 0, y: 0 }, { id: 'point', kind: 'circle', x: 5, y: 5 }
    ] } })).toThrow(/unique/i)
  })
  it('rejects unbounded or invalid controls before they reach a simulation', () => {
    expect(() => simulationArtifactSchema.parse({ id: 'sim', title: 'model', source: 'globalThis.simulation={}', assumptions: [],
      controls: [{ id: 'n', label: 'Count', type: 'slider', value: 4, min: 10, max: 1 }] })).toThrow()
  })
  it('retains an explicit illustrative status for an unchecked experiment', () => {
    const beat = parseTeachingBeat({ narration: 'This is a simplified model.', canvas: { mode: 'replace', entities: [] },
      simulation: { id: 'fresh-model', title: 'Population feedback', source: 'globalThis.simulation={}', controls: [], assumptions: ['A simplified model'] }
    })
    expect(beat.simulation?.validation).toBe('illustrative')
  })
  it('bounds checkpoint state and complete replay history separately from aggregate transfer space', () => {
    const artifact = { id: 'bounded', title: 'Model', source: 'globalThis.simulation={}', controls: [], assumptions: [], validation: 'illustrative' as const }
    const base = { artifact, state: {}, tick: 100, values: {}, initialValues: {}, inputs: [] }
    expect(simulationCheckpointSchema.safeParse({ ...base, state: 'x'.repeat(LIMITS.sceneBytes) }).success).toBe(false)
    const values = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`control${i}`, '文'.repeat(200)]))
    const inputs = Array.from({ length: 100 }, (_, tick) => ({ tick, values }))
    expect(new TextEncoder().encode(JSON.stringify(inputs)).byteLength).toBeGreaterThan(LIMITS.inputHistoryBytes)
    expect(simulationCheckpointSchema.safeParse({ ...base, inputs }).success).toBe(false)
    expect(simulationCheckpointSchema.safeParse({ ...base, inputs: [{ tick: 99, values: {} }, { tick: 98, values: {} }] }).success).toBe(false)
  })
})

