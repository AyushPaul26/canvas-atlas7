import { z } from 'zod';
import type { Control } from './core';

export const MATH_LIMITS = Object.freeze({ sourceBytes: 64 * 1024, primitives: 32, expressionNodes: 256, expressionDepth: 8, samples: 4096 });
const id = z.string().min(1).max(100).regex(/^[\w:.-]+$/);
const finite = z.number().finite().min(-1_000_000).max(1_000_000);
const label = z.string().max(120);
export const mathBoundsSchema = z.object({ left: finite, right: finite, bottom: finite, top: finite }).strict().refine(b => b.left < b.right && b.bottom < b.top && b.right - b.left >= .000001 && b.top - b.bottom >= .000001, 'Math bounds must have positive width and height');
const axesSchema = z.object({ xLabel: label.optional(), yLabel: label.optional() }).strict();
const dragSchema = z.object({ xControl: id.optional(), yControl: id.optional() }).strict().refine(d => !!(d.xControl || d.yControl), 'A draggable point needs a control binding');
const operators = ['add', 'subtract', 'multiply', 'divide', 'power', 'negate', 'sin', 'cos', 'tan', 'sqrt', 'abs', 'exp', 'ln'] as const;
type Operator = typeof operators[number];
export type MathExpression = number | { control: string } | { variable: 'x' | 't' } | { op: Operator; args: MathExpression[] };
const expressionSchema: z.ZodType<MathExpression> = z.lazy(() => z.union([
  finite, z.object({ control: id }).strict(), z.object({ variable: z.enum(['x', 't']) }).strict(),
  z.object({ op: z.enum(operators), args: z.array(expressionSchema).min(1).max(2) }).strict().refine(e => e.args.length === (['add', 'subtract', 'multiply', 'divide', 'power'].includes(e.op) ? 2 : 1), 'Incorrect number of math operands'),
]));
const rawModelSchema = z.object({
  version: z.literal(1), kind: z.literal('math'), bounds: mathBoundsSchema, axes: axesSchema.optional(),
  points: z.array(z.object({ id, label: label.optional(), x: expressionSchema, y: expressionSchema, drag: dragSchema.optional() }).strict()).max(MATH_LIMITS.primitives),
  plots: z.array(z.object({ id, label: label.optional(), expression: expressionSchema, domain: z.object({ min: finite, max: finite }).strict().refine(d => d.min < d.max, 'Plot domain minimum must be below maximum'), samples: z.number().int().min(16).max(256).default(128) }).strict()).max(MATH_LIMITS.primitives),
  vectors: z.array(z.object({ id, label: label.optional(), from: id, to: id }).strict()).max(MATH_LIMITS.primitives),
}).strict().superRefine((model, ctx) => {
  const items = [...model.points, ...model.plots, ...model.vectors];
  if (!items.length || new Set(items.map(item => item.id)).size !== items.length) ctx.addIssue({ code: 'custom', message: 'Math objects need unique IDs and at least one object' });
  const pointIds = new Set(model.points.map(p => p.id));
  if (model.vectors.some(v => !pointIds.has(v.from) || !pointIds.has(v.to))) ctx.addIssue({ code: 'custom', message: 'Vector endpoints must reference declared points' });
  if (model.plots.reduce((sum, plot) => sum + plot.samples, 0) > MATH_LIMITS.samples) ctx.addIssue({ code: 'custom', message: 'Math plot sample budget exceeded' });
  let nodes = 0;
  const inspect = (expression: MathExpression, depth = 0): boolean => {
    if (++nodes > MATH_LIMITS.expressionNodes || depth > MATH_LIMITS.expressionDepth) return false;
    return typeof expression === 'number' || !('op' in expression) || expression.args.every(arg => inspect(arg, depth + 1));
  };
  if (![...model.points.flatMap(p => [p.x, p.y]), ...model.plots.map(p => p.expression)].every(e => inspect(e))) ctx.addIssue({ code: 'custom', message: 'Math expression complexity exceeded' });
});
export type MathModel = z.infer<typeof rawModelSchema>;

// Reject hostile depth/cycles before the recursive schema is entered.
function shallowEnvelope(value: unknown): boolean {
  const pending: Array<[unknown, number]> = [[value, 0]], seen = new Set<object>(); let nodes = 0, chars = 0;
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (++nodes > 5000 || depth > 24) return false;
    if (typeof item === 'string') chars += item.length;
    if (chars > MATH_LIMITS.sourceBytes) return false;
    if (item && typeof item === 'object') {
      if (seen.has(item)) return false; seen.add(item);
      for (const [key, child] of Object.entries(item)) { chars += key.length; pending.push([child, depth + 1]); }
    }
  }
  return true;
}
export const mathModelSchema = z.unknown().transform((value, ctx): MathModel => {
  if (!shallowEnvelope(value)) { ctx.addIssue({ code: 'custom', message: 'Math model exceeds its bounded data envelope' }); return z.NEVER; }
  const parsed = rawModelSchema.safeParse(value);
  if (!parsed.success) { for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message }); return z.NEVER; }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MATH_LIMITS.sourceBytes) { ctx.addIssue({ code: 'custom', message: 'Math model source is too large' }); return z.NEVER; }
  return parsed.data;
});

const tuple = z.tuple([finite, finite]);
export const mathFrameSchema = z.object({
  kind: z.literal('math'), bounds: mathBoundsSchema, axes: axesSchema,
  tick: z.number().int().min(0).max(36000), time: z.number().finite().min(0).max(600),
  controls: z.array(z.object({ id, min: finite, max: finite, step: z.number().finite().positive().optional() }).strict().refine(c => c.min < c.max)).max(32),
  points: z.array(z.object({ id, label: label.optional(), x: finite, y: finite, drag: dragSchema.optional() }).strict()).max(MATH_LIMITS.primitives),
  curves: z.array(z.object({ id, label: label.optional(), segments: z.array(z.array(tuple).min(2).max(256)).max(128) }).strict()).max(MATH_LIMITS.primitives),
  vectors: z.array(z.object({ id, label: label.optional(), from: tuple, to: tuple }).strict()).max(MATH_LIMITS.primitives),
}).strict().superRefine((frame, ctx) => {
  const objects = [...frame.points, ...frame.curves, ...frame.vectors];
  if (new Set(objects.map(o => o.id)).size !== objects.length || new Set(frame.controls.map(c => c.id)).size !== frame.controls.length) ctx.addIssue({ code: 'custom', message: 'Math frame identifiers must be unique' });
  if (frame.curves.reduce((sum, curve) => sum + curve.segments.reduce((count, segment) => count + segment.length, 0), 0) > MATH_LIMITS.samples) ctx.addIssue({ code: 'custom', message: 'Math frame sample budget exceeded' });
  const controls = new Set(frame.controls.map(c => c.id));
  if (frame.points.some(p => p.drag && [p.drag.xControl, p.drag.yControl].some(c => c !== undefined && !controls.has(c)))) ctx.addIssue({ code: 'custom', message: 'Math frame has an unknown drag control' });
});
export type MathFrame = z.infer<typeof mathFrameSchema>;

export function validateMathBindings(model: MathModel, controls: Control[]): void {
  const byId = new Map(controls.map(c => [c.id, c]));
  const requireNumeric = (key: string): Control => {
    const control = byId.get(key);
    if (!control || !['slider', 'number'].includes(control.type) || typeof control.value !== 'number') throw new Error(`Math model needs a numeric control: ${key}`);
    if (!Number.isFinite(control.min) || !Number.isFinite(control.max) || control.min! >= control.max!) throw new Error(`Math control must be bounded: ${key}`);
    return control;
  };
  const inspect = (e: MathExpression, point: boolean): void => {
    if (typeof e === 'number') return;
    if ('control' in e) { requireNumeric(e.control); return; }
    if ('variable' in e) { if (point && e.variable === 'x') throw new Error('Point coordinates cannot use the plot variable x'); return; }
    e.args.forEach(arg => inspect(arg, point));
  };
  for (const p of model.points) {
    inspect(p.x, true); inspect(p.y, true);
    for (const axis of ['x', 'y'] as const) {
      const key = p.drag?.[axis === 'x' ? 'xControl' : 'yControl']; if (!key) continue;
      requireNumeric(key); const coordinate = p[axis];
      if (typeof coordinate === 'number' || !('control' in coordinate) || coordinate.control !== key) throw new Error('Dragged coordinates must directly reference their control');
    }
    if (p.drag?.xControl && p.drag.xControl === p.drag.yControl) throw new Error('Point axes need distinct drag controls');
  }
  for (const p of model.plots) inspect(p.expression, false);
}
