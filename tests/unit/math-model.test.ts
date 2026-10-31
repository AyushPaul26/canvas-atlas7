import { describe, expect, it } from 'vitest';
import { mathFrameSchema, mathModelSchema, validateMathBindings, type MathModel } from '../../packages/protocol/src/math-model';
import { createMathModelSession } from '../../packages/simulation/src/math-model';
import type { Control } from '../../packages/protocol/src/index';

const controls: Control[] = [{ id: 'a', label: 'Slope', type: 'slider', value: 2, min: -5, max: 5, step: .5 }, { id: 'px', label: 'Point x', type: 'number', value: 1, min: -5, max: 5, step: .5 }];
const model = (): MathModel => mathModelSchema.parse({ version: 1, kind: 'math', bounds: { left: -5, right: 5, bottom: -5, top: 5 }, axes: { xLabel: 'x', yLabel: 'y' }, points: [{ id: 'origin', label: 'Origin', x: 0, y: 0 }, { id: 'p', label: 'P', x: { control: 'px' }, y: { op: 'multiply', args: [{ control: 'a' }, { control: 'px' }] }, drag: { xControl: 'px' } }], plots: [{ id: 'line', label: 'y = ax', expression: { op: 'multiply', args: [{ control: 'a' }, { variable: 'x' }] }, domain: { min: -5, max: 5 }, samples: 20 }], vectors: [{ id: 'v', label: 'Position', from: 'origin', to: 'p' }] });
const frame = (session: ReturnType<typeof createMathModelSession>) => mathFrameSchema.parse(session.render().state);

describe('bounded declarative school maths', () => {
  it('projects linked algebra, points and vectors into finite canonical drawing primitives', () => {
    const session = createMathModelSession(model(), controls, { a: 2, px: 1 });
    expect(frame(session).points.find(p => p.id === 'p')).toMatchObject({ x: 1, y: 2, drag: { xControl: 'px' } });
    expect(frame(session).vectors[0]).toMatchObject({ from: [0, 0], to: [1, 2] });
    expect(session.render().entities.some(e => e.kind === 'arrow')).toBe(true);
    const vector = session.render().entities.find(e => e.id === 'math:v')!;
    expect(Math.abs(vector.points![3] / vector.points![2])).toBeCloseTo(2);
    expect(session.render().entities.find(e => e.id === 'math:line:label')).toMatchObject({ kind: 'text', text: 'y = ax', fill: '#5754BD' });
    expect(session.render().entities.every(e => Number.isFinite(e.x) && Number.isFinite(e.y))).toBe(true);
    const changed = mathFrameSchema.parse(session.input({ a: -1, px: 2 }).state);
    expect(changed.points.find(p => p.id === 'p')).toMatchObject({ x: 2, y: -2 });
    expect(changed.tick).toBe(0);
    session.dispose();
    expect(() => session.render()).toThrow(/closed/i);
  });
  it('advances time only when stepped and restores deterministic frames through the same inputs', () => {
    const value = model(); value.points[0].x = { op: 'sin', args: [{ variable: 't' }] };
    const one = createMathModelSession(value, controls, { a: 2, px: 1 });
    const two = createMathModelSession(value, controls, { a: 2, px: 1 });
    expect(frame(one).time).toBe(0);
    expect(one.step()).toEqual(two.step());
    expect(frame(one).time).toBeCloseTo(1 / 60);
    expect(frame(one).points[0].x).toBeCloseTo(Math.sin(1 / 60));
    expect(frame(one)).toEqual(frame(one));
  });
  it('omits undefined function samples and never bridges a reciprocal asymptote', () => {
    for (const samples of [20, 21, 128]) {
      const value = model(); value.plots[0].expression = { op: 'divide', args: [1, { variable: 'x' }] }; value.plots[0].samples = samples;
      const result = frame(createMathModelSession(value, controls, { a: 2, px: 1 }));
      expect(result.curves[0].segments.length).toBeGreaterThan(1);
      for (const segment of result.curves[0].segments) {
        expect(segment.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
        expect(segment.some(([x]) => x < 0) && segment.some(([x]) => x > 0)).toBe(false);
      }
    }
  });
  it('rejects executable strings, unknown operations, excess expression depth and work budgets', () => {
    const value = model();
    expect(mathModelSchema.safeParse({ ...value, plots: [{ ...value.plots[0], expression: 'window.fetch("https://example.com")' }] }).success).toBe(false);
    expect(mathModelSchema.safeParse({ ...value, points: [{ ...value.points[0], x: { op: 'eval', args: [1] } }] }).success).toBe(false);
    let nested: unknown = 1; for (let i = 0; i < 10; i++) nested = { op: 'sin', args: [nested] };
    expect(mathModelSchema.safeParse({ ...value, points: [{ ...value.points[0], x: nested }] }).success).toBe(false);
    expect(mathModelSchema.safeParse({ ...value, plots: Array.from({ length: 32 }, (_, i) => ({ ...value.plots[0], id: `plot${i}`, samples: 256 })) }).success).toBe(false);
  });
  it('requires known bounded numeric controls and reversible direct-coordinate drag bindings', () => {
    expect(() => validateMathBindings(model(), controls)).not.toThrow();
    const missing = model(); missing.points[1].drag = { xControl: 'unknown' };
    expect(() => validateMathBindings(missing, controls)).toThrow(/control/i);
    const indirect = model(); indirect.points[1].drag = { yControl: 'a' };
    expect(() => validateMathBindings(indirect, controls)).toThrow(/direct/i);
    const cyclic = model(); cyclic.vectors[0].to = 'v';
    expect(() => mathModelSchema.parse(cyclic)).toThrow();
    expect(() => createMathModelSession(model(), [{ ...controls[0], min: undefined }, controls[1]], { a: 2, px: 1 })).toThrow(/bounded/i);
    const session = createMathModelSession(model(), controls, { a: 2, px: 1 });
    expect(() => session.input({ a: 100 })).toThrow(/range/i);
    expect(frame(session).points.find(p => p.id === 'p')?.y).toBe(2);
  });
});
