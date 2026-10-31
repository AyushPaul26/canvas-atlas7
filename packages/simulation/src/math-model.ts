import { controlSchema, parseScene, type Control, type SceneEntity, type SimulationResult } from '../../protocol/src/index.ts';
import { mathFrameSchema, mathModelSchema, validateMathBindings, type MathExpression, type MathFrame, type MathModel } from '../../protocol/src/math-model.ts';
import type { ModelSession, ModelValues } from './model-contract.ts';

const PALETTE = ['#5754BD', '#23836A', '#A86615', '#456B9C'];
const defined = (number: number): number => Number.isFinite(number) && Math.abs(number) <= 1_000_000 ? number : NaN;
function evaluate(expression: MathExpression, values: ModelValues, x: number, time: number): number {
  if (typeof expression === 'number') return expression;
  if ('control' in expression) return Number(values[expression.control]);
  if ('variable' in expression) return expression.variable === 'x' ? x : time;
  const a = evaluate(expression.args[0], values, x, time), b = expression.args.length === 2 ? evaluate(expression.args[1], values, x, time) : 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  let result: number;
  switch (expression.op) {
    case 'add': result = a + b; break;
    case 'subtract': result = a - b; break;
    case 'multiply': result = a * b; break;
    case 'divide': result = b === 0 ? NaN : a / b; break;
    case 'power': result = a ** b; break;
    case 'negate': result = -a; break;
    case 'sin': result = Math.sin(a); break;
    case 'cos': result = Math.cos(a); break;
    case 'tan': result = Math.abs(Math.cos(a)) < 1e-10 ? NaN : Math.tan(a); break;
    case 'sqrt': result = Math.sqrt(a); break;
    case 'abs': result = Math.abs(a); break;
    case 'exp': result = Math.exp(a); break;
    case 'ln': result = Math.log(a); break;
  }
  return defined(result);
}

function project(frame: MathFrame): SceneEntity[] {
  const { left, right, top, bottom } = frame.bounds;
  const scale = Math.min(820 / (right - left), 470 / (top - bottom));
  const width = (right - left) * scale, height = (top - bottom) * scale;
  const leftPixel = 80 + (820 - width) / 2, topPixel = 80 + (470 - height) / 2;
  const x = (value: number) => leftPixel + (value - left) * scale;
  const y = (value: number) => topPixel + height - (value - bottom) * scale;
  const axisY = y(Math.max(bottom, Math.min(top, 0))), axisX = x(Math.max(left, Math.min(right, 0)));
  const entities: SceneEntity[] = [
    { id: 'math:axis:x', kind: 'arrow', x: leftPixel, y: axisY, points: [0, 0, width + 15, 0], stroke: '#667185', strokeWidth: 1.5 },
    { id: 'math:axis:y', kind: 'arrow', x: axisX, y: topPixel + height, points: [0, 0, 0, -height - 15], stroke: '#667185', strokeWidth: 1.5 },
    { id: 'math:axis:x-label', kind: 'text', x: leftPixel + width + 23, y: axisY - 10, text: frame.axes.xLabel ?? 'x', fontSize: 20, width: 100 },
    { id: 'math:axis:y-label', kind: 'text', x: axisX + 12, y: topPixel - 38, text: frame.axes.yLabel ?? 'y', fontSize: 20, width: 180 },
  ];
  const niceStep = (span: number) => { const power = 10 ** Math.floor(Math.log10(span / 8)); return [1, 2, 5, 10].find(v => v * power >= span / 8)! * power; };
  for (const axis of ['x', 'y'] as const) {
    const low = axis === 'x' ? left : bottom, high = axis === 'x' ? right : top, step = niceStep(high - low);
    for (let i = Math.ceil(low / step), count = 0; i * step <= high && count < 20; i++, count++) {
      const value = Number((i * step).toPrecision(8)), coordinate = axis === 'x' ? x(value) : y(value);
      entities.push({ id: `math:grid:${axis}:${count}`, kind: 'line', x: axis === 'x' ? coordinate : leftPixel, y: axis === 'x' ? topPixel : coordinate, points: axis === 'x' ? [0, 0, 0, height] : [0, 0, width, 0], stroke: '#DFE4EC', strokeWidth: .7 });
      if (value !== 0) entities.push({ id: `math:tick:${axis}:${count}`, kind: 'text', x: axis === 'x' ? coordinate - 20 : axisX - 52, y: axis === 'x' ? axisY + 9 : coordinate - 10, text: String(value), fontSize: 15, width: 55, fill: '#667185' });
    }
  }
  for (const [index, curve] of frame.curves.entries()) {
    for (const [segmentIndex, segment] of curve.segments.entries()) entities.push({ id: `math:${curve.id}:segment:${segmentIndex}`, kind: 'path', x: 0, y: 0, points: segment.flatMap(p => [x(p[0]), y(p[1])]), stroke: PALETTE[index % PALETTE.length], strokeWidth: 3 });
    const segment = [...curve.segments].sort((a, b) => b.length - a.length)[0];
    if (curve.label && segment?.length) {
      const anchor = segment[Math.floor((segment.length - 1) * .7)];
      const labelX = x(anchor[0]) + 12, labelY = y(anchor[1]) - 28 - index % 3 * 18;
      entities.push({ id: `math:${curve.id}:label`, kind: 'text', x: Math.max(40, Math.min(760, labelX)), y: Math.max(35, Math.min(560, labelY)), text: curve.label, fill: PALETTE[index % PALETTE.length], fontSize: 18, width: 200 });
    }
  }
  for (const [index, vector] of frame.vectors.entries()) {
    const start = [x(vector.from[0]), y(vector.from[1])], end = [x(vector.to[0]), y(vector.to[1])];
    entities.push({ id: `math:${vector.id}`, kind: 'arrow', x: start[0], y: start[1], points: [0, 0, end[0] - start[0], end[1] - start[1]], stroke: PALETTE[(index + 1) % PALETTE.length], strokeWidth: 3 });
    if (vector.label) entities.push({ id: `math:${vector.id}:label`, kind: 'text', x: (start[0] + end[0]) / 2 + 10, y: (start[1] + end[1]) / 2 - 24, text: vector.label, fontSize: 18, width: 220 });
  }
  for (const p of frame.points) {
    entities.push({ id: `math:${p.id}`, kind: 'circle', x: x(p.x), y: y(p.y), radius: 5, stroke: '#5754BD', fill: '#C3E9D7', strokeWidth: 2 });
    if (p.label) entities.push({ id: `math:${p.id}:label`, kind: 'text', x: x(p.x) + 12, y: y(p.y) - 24, text: `${p.label} (${Number(p.x.toFixed(3))}, ${Number(p.y.toFixed(3))})`, fontSize: 18, width: 250 });
  }
  // The same finite, plain primitives enter saved lessons and PDF diagrams.
  return parseScene(entities);
}

export function createMathModelSession(input: MathModel, declarations: Control[], initial: ModelValues): ModelSession {
  const model = mathModelSchema.parse(input), controls = declarations.map(c => controlSchema.parse(c));
  validateMathBindings(model, controls);
  const declared = new Map(controls.map(c => [c.id, c]));
  let values: ModelValues = Object.fromEntries(controls.map(c => [c.id, c.value])), tick = 0, closed = false;
  const acceptValues = (incoming: ModelValues): ModelValues => {
    const next = { ...values };
    for (const [key, value] of Object.entries(incoming)) {
      const control = declared.get(key);
      if (!control) throw new Error('Math model received an unknown control');
      const result = controlSchema.safeParse({ ...control, value });
      if (!result.success) throw new Error('Math control value is outside its allowed range');
      next[key] = value;
    }
    return next;
  };
  values = acceptValues(initial);
  const alive = () => { if (closed) throw new Error('This math experiment has closed'); };
  const render = (): SimulationResult => {
    alive(); const time = tick / 60, bounds = model.bounds;
    const visible = (x: number, y: number) => Number.isFinite(x) && Number.isFinite(y) && x >= bounds.left && x <= bounds.right && y >= bounds.bottom && y <= bounds.top;
    const points: MathFrame['points'] = model.points.flatMap(p => {
      const x = evaluate(p.x, values, 0, time), y = evaluate(p.y, values, 0, time);
      return visible(x, y) ? [{ id: p.id, ...(p.label !== undefined ? { label: p.label } : {}), x, y, ...(p.drag ? { drag: p.drag } : {}) }] : [];
    });
    const curves: MathFrame['curves'] = model.plots.map(plot => {
      const segments: Array<Array<[number, number]>> = []; let current: Array<[number, number]> = [];
      const flush = () => { if (current.length > 1) segments.push(current); current = []; };
      const min = Math.max(plot.domain.min, bounds.left), max = Math.min(plot.domain.max, bounds.right);
      if (min < max) for (let i = 0; i < plot.samples; i++) {
        const x = min + i / (plot.samples - 1) * (max - min), y = evaluate(plot.expression, values, x, time);
        if (!visible(x, y)) { flush(); continue; }
        if (current.length) {
          const previous = current.at(-1)!, middleX = (previous[0] + x) / 2;
          const middleY = evaluate(plot.expression, values, middleX, time);
          if (!visible(middleX, middleY) || Math.abs(y - previous[1]) > (bounds.top - bounds.bottom) * .8 || Math.abs(middleY - (previous[1] + y) / 2) > (bounds.top - bounds.bottom) * .25) flush();
        }
        current.push([x, y]);
      }
      flush(); return { id: plot.id, ...(plot.label !== undefined ? { label: plot.label } : {}), segments };
    });
    const vectors: MathFrame['vectors'] = model.vectors.flatMap(vector => {
      const from = points.find(p => p.id === vector.from), to = points.find(p => p.id === vector.to);
      return from && to ? [{ id: vector.id, ...(vector.label !== undefined ? { label: vector.label } : {}), from: [from.x, from.y] as [number, number], to: [to.x, to.y] as [number, number] }] : [];
    });
    const state = mathFrameSchema.parse({ kind: 'math', bounds, axes: model.axes ?? {}, tick, time, controls: controls.filter(c => typeof c.value === 'number' && Number.isFinite(c.min) && Number.isFinite(c.max)).map(c => ({ id: c.id, min: c.min!, max: c.max!, ...(c.step ? { step: c.step } : {}) })), points, curves, vectors });
    return { state, entities: project(state), measurements: Object.fromEntries(points.flatMap(p => [[`${p.id.slice(0, 90)}.x`, p.x], [`${p.id.slice(0, 90)}.y`, p.y]])) };
  };
  return {
    render,
    step: () => { alive(); if (tick >= 36000) throw new Error('Reset this math experiment to continue'); tick++; return render(); },
    input: incoming => { alive(); const next = acceptValues(incoming); const previous = values; values = next; try { return render(); } catch (error) { values = previous; throw error; } },
    dispose: () => { closed = true; values = {}; },
  };
}
