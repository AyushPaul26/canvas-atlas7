import { describe, expect, it } from 'vitest'
import { buildLessonContext, buildTeacherInstructions, getTeachingToolParameters, MAX_CONTEXT_BYTES } from '../../packages/teacher/src/index'
import type { LessonSession } from '../../packages/protocol/src/index'

describe('adaptive teacher context', () => {
  const lesson: LessonSession = { id: 's', title: 'New concept', topic: 'suffixes', createdAt: '', updatedAt: '', messages: [],
    beats: [], scene: [{ id: 'word', kind: 'text', x: 10, y: 10, text: 'kindness' }], controls: {} }
  it('includes the selected visible object without pretending an unspoken lesson happened', () => {
    const context = buildLessonContext(lesson, 'Explain this more simply', ['word'])
    expect(context).toContain('kindness')
    expect(context).toContain('Explain this more simply')
    expect(context).toContain('word')
  })
  it('instructs a general teacher to change strategy instead of using a topic catalogue', () => {
    const instructions = buildTeacherInstructions()
    expect(instructions).toMatch(/different.*(?:example|representation|analogy)/is)
    expect(instructions).toContain('present_beat')
    expect(instructions).toContain('globalThis.simulation')
    expect(instructions).toContain('at most two short beats')
  })
  it('emits recursive strict tool schemas with nullable optional properties', () => {
    const visit = (schema: Record<string, unknown>) => {
      if (schema.type === 'object') { const properties = schema.properties as Record<string, unknown>; expect(schema.required).toEqual(Object.keys(properties)); expect(schema.additionalProperties).toBe(false); }
      for (const [key, value] of Object.entries(schema)) {
        expect(key).not.toBe('default');
        if (key === 'properties') {
          for (const child of Object.values(value as Record<string, Record<string, unknown>>)) visit(child);
        } else if (Array.isArray(value)) {
          for (const child of value) if (child && typeof child === 'object') visit(child);
        } else if (value && typeof value === 'object') visit(value as Record<string, unknown>);
      }
    };
    const schema = getTeachingToolParameters(); visit(schema); const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.simulation.anyOf).toContainEqual({ type: 'null' }); expect(properties.narration.type).toBe('string');
  })
  it('bounds context bytes, summarizes geometry and prioritizes selected visible IDs', () => {
    const large: LessonSession = { ...lesson, messages: Array.from({ length: 14 }, (_, i) => ({ id: String(i), role: 'student', text: '文'.repeat(4000), createdAt: '' })), scene: Array.from({ length: 180 }, (_, i) => ({ id: `plot${i}`, kind: 'plot', x: 0, y: 0, text: '文'.repeat(4000), points: i === 179 ? Array(100000).fill(999999.999) : [] })) };
    const text = buildLessonContext(large, 'Explain the selected curve', ['plot179']);
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
    const context = JSON.parse(text); expect(context.learnerRequest).toBe('Explain the selected curve'); expect(context.selectedObjects[0].id).toBe('plot179'); expect(context.selectedObjects[0].points).toBeUndefined(); expect(context.selectedObjects[0].pointCount).toBe(50000);
  })
  it('preserves instructions after character 4,100 in the complete current question', () => {
    const request = `${'Background material. '.repeat(240)}Explain the final example using conservation of momentum.`;
    expect(request.length).toBeGreaterThan(4100);
    expect(request.length).toBeLessThanOrEqual(6000);
    const context = JSON.parse(buildLessonContext({ ...lesson, scene: [] }, request));
    expect(context.learnerRequest).toBe(request);
    expect(context.contextTruncated).toBe(false);
  })
  it('reserves the full 6,000-character multibyte request before trimming older context', () => {
    const request = `${'文'.repeat(5974)}Now explain the last case.`;
    expect(request).toHaveLength(6000);
    const large: LessonSession = { ...lesson, messages: Array.from({ length: 14 }, (_, i) => ({ id: String(i), role: 'student', text: '文'.repeat(4000), createdAt: '' })), scene: Array.from({ length: 180 }, (_, i) => ({ id: `plot${i}`, kind: 'plot', x: 0, y: 0, text: '文'.repeat(4000), points: [] })) };
    const text = buildLessonContext(large, request, ['plot179']);
    const context = JSON.parse(text);
    expect(context.learnerRequest).toBe(request);
    expect(context.selectedObjects[0].id).toBe('plot179');
    expect(context.contextTruncated).toBe(true);
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
  })
  it('clearly rejects a request beyond the accepted learner input limit', () => {
    expect(() => buildLessonContext(lesson, 'x'.repeat(6001))).toThrow(/6,?000.*characters/i);
  })
  it('does not treat prepared future beats as seen experiments or heard narration', () => {
    const context = buildLessonContext({ ...lesson, beats: [{ id: 'future', narration: 'Unheard secret narration', canvas: { mode: 'replace', entities: [{ id: 'unseen', kind: 'text', x: 0, y: 0, text: 'Not presented yet' }] }, simulation: { id: 'not-acknowledged', title: 'Unseen experiment', source: '', controls: [], assumptions: [], validation: 'illustrative' } }] }, 'Continue');
    expect(context).not.toContain('Unheard secret narration'); expect(context).not.toContain('Unseen experiment'); expect(context).not.toContain('Not presented yet');
    expect(JSON.parse(context).visibleScene[0].id).toBe('word');
  })
})

