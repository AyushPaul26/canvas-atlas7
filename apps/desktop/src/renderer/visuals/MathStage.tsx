import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import JXG from 'jsxgraph';
import { mathFrameSchema, type MathFrame } from '@living-canvas/protocol';
import './math-stage.css';

export interface MathStageProps {
  state: MathFrame;
  interactive: boolean;
  onChange: (values: Record<string, number>) => void;
  onFailure?: (message: string) => void;
}
type NumericControl = MathFrame['controls'][number];
const colours = ['#5754BD', '#23836A', '#A86615', '#456B9C'];
const snap = (value: number, control: NumericControl): number => {
  const bounded = Math.max(control.min, Math.min(control.max, value));
  const stepped = control.step ? control.min + Math.round((bounded - control.min) / control.step) * control.step : bounded;
  return Number(Math.max(control.min, Math.min(control.max, stepped)).toPrecision(12));
};

function CoordinateField({ name, value, control, interactive, onChange }: { name: string; value: number; control: NumericControl; interactive: boolean; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value)), latest = useRef(value);
  useLayoutEffect(() => { latest.current = value; setDraft(String(value)); }, [value, interactive]);
  const commit = () => {
    if (!interactive) return;
    const raw = draft.trim() ? Number(draft) : NaN;
    if (!Number.isFinite(raw)) { setDraft(String(value)); return; }
    const accepted = snap(raw, control); setDraft(String(accepted));
    if (accepted !== latest.current) { latest.current = accepted; onChange(accepted); }
  };
  return <label className="math-stage-coordinate"><span>{name}</span><input type="number" value={draft} min={control.min} max={control.max} step={control.step ?? 'any'} disabled={!interactive} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); commit(); } if (event.key === 'Escape') setDraft(String(value)); }} /></label>;
}

/** Numeric SVG only: model text stays in React, and JSXGraph never parses an AI expression. */
export default function MathStage({ state, interactive, onChange, onFailure }: MathStageProps) {
  const element = useRef<HTMLDivElement>(null), callbacks = useRef({ onChange, onFailure });
  callbacks.current = { onChange, onFailure };
  const accepted = useMemo(() => mathFrameSchema.safeParse(state), [state]);
  const frame = accepted.success ? accepted.data : undefined;
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const host = element.current;
    if (!host) return;
    if (!frame) { setFailed(true); callbacks.current.onFailure?.('Interactive drawing unavailable. The lesson diagram is still available.'); return; }
    let board: JXG.Board | undefined, observer: ResizeObserver | undefined, disposed = false;
    const dispose = () => { if (disposed) return; disposed = true; observer?.disconnect(); if (board) JXG.JSXGraph.freeBoard(board); };
    try {
      // JSXGraph's bundled declarations lag the current keyboard option.
      const options: Partial<JXG.BoardAttributes> & { keyboard: { enabled: boolean } } = {
        title: 'Maths graph',
        renderer: 'svg', boundingbox: [frame.bounds.left, frame.bounds.top, frame.bounds.right, frame.bounds.bottom],
        keepaspectratio: true, axis: true, grid: true, showCopyright: false, showNavigation: false,
        pan: { enabled: false }, zoom: false, keyboard: { enabled: false },
        defaultAxes: { x: { ticks: { label: { display: 'internal', parse: false, useMathJax: false, fontSize: 12 } } }, y: { ticks: { label: { display: 'internal', parse: false, useMathJax: false, fontSize: 12 } } } },
      };
      board = JXG.JSXGraph.initBoard(host, options);
      const active = board;
      const controls = new Map(frame.controls.map(c => [c.id, c]));
      active.suspendUpdate();
      for (const [index, curve] of frame.curves.entries()) for (const segment of curve.segments) {
        active.create('curve', [segment.map(p => p[0]), segment.map(p => p[1])], { strokeColor: colours[index % colours.length], strokeWidth: 3, highlight: false, fixed: true });
      }
      for (const [index, vector] of frame.vectors.entries()) active.create('arrow', [vector.from, vector.to], { strokeColor: colours[(index + 1) % colours.length], strokeWidth: 3, highlight: false, fixed: true, point1: { visible: false, name: '', withLabel: false }, point2: { visible: false, name: '', withLabel: false } });
      for (const p of frame.points) {
        const point = active.create('point', [p.x, p.y], { name: '', withLabel: false, showInfobox: false, size: 5, fillColor: '#C3E9D7', strokeColor: '#5754BD', strokeWidth: 2, fixed: !interactive || !p.drag, highlight: interactive && !!p.drag, highlightFillColor: '#7775E7', highlightStrokeColor: '#5754BD' });
        if (!interactive || !p.drag) continue;
        const xControl = p.drag.xControl ? controls.get(p.drag.xControl) : undefined, yControl = p.drag.yControl ? controls.get(p.drag.yControl) : undefined;
        point.on('drag', () => {
          if (disposed) return;
          const x = xControl ? Math.max(xControl.min, Math.min(xControl.max, point.X())) : p.x;
          const y = yControl ? Math.max(yControl.min, Math.min(yControl.max, point.Y())) : p.y;
          point.setPosition(JXG.COORDS_BY_USER, [x, y]);
        });
        point.on('up', () => {
          if (disposed) return;
          const next: Record<string, number> = {};
          if (xControl && Number.isFinite(point.X())) next[xControl.id] = snap(point.X(), xControl);
          if (yControl && Number.isFinite(point.Y())) next[yControl.id] = snap(point.Y(), yControl);
          // Keep accepted geometry until the shared runtime commits the new controls.
          point.setPosition(JXG.COORDS_BY_USER, [p.x, p.y]); active.update();
          if (Object.keys(next).some(key => next[key] !== (key === xControl?.id ? p.x : p.y))) callbacks.current.onChange(next);
        });
      }
      active.unsuspendUpdate();
      const resize = () => { if (!disposed) { const size = host.getBoundingClientRect(); if (size.width && size.height) active.resizeContainer(size.width, size.height, true); } };
      if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(resize); observer.observe(host); }
      resize(); setFailed(false);
      return dispose;
    } catch {
      dispose(); setFailed(true); callbacks.current.onFailure?.('Interactive drawing unavailable. The lesson diagram is still available.');
    }
  }, [frame, interactive]);
  return <section className="math-stage" aria-label="Interactive maths diagram">
    <div className="math-stage-axes"><span>Horizontal: <strong>{frame?.axes.xLabel ?? 'x'}</strong></span><span>Vertical: <strong>{frame?.axes.yLabel ?? 'y'}</strong></span></div>
    <div ref={element} className="math-stage-board" aria-label="Maths graph" />
    {failed && <p role="status" className="math-stage-hint">Open the lesson diagram to continue. The interactive drawing could not be displayed.</p>}
    <div className="math-stage-readout">
      {frame?.curves.map((curve, index) => curve.label ? <span key={curve.id} className="math-stage-key"><i aria-hidden="true" style={{ backgroundColor: colours[index % colours.length] }} />{curve.label}</span> : null)}
      {frame?.vectors.map((vector, index) => vector.label ? <span key={vector.id} className="math-stage-key"><i aria-hidden="true" style={{ backgroundColor: colours[(index + 1) % colours.length] }} />↗ {vector.label}</span> : null)}
    </div>
    {frame?.points.map(p => <div key={p.id} className="math-stage-point"><strong>{p.label ?? p.id}</strong><span className="math-stage-position">({Number(p.x.toFixed(3))}, {Number(p.y.toFixed(3))})</span>{(['x', 'y'] as const).map(axis => {
      const controlId = p.drag?.[axis === 'x' ? 'xControl' : 'yControl'], control = frame.controls.find(c => c.id === controlId);
      return control ? <CoordinateField key={axis} name={`${p.label ?? p.id} ${axis}`} value={p[axis]} control={control} interactive={interactive && !failed} onChange={value => callbacks.current.onChange({ [control.id]: value })} /> : null;
    })}</div>)}
    <p className="math-stage-hint">{interactive ? 'Drag a highlighted point, or change its coordinates. Your lesson stays paused while you explore.' : 'Pause teaching and choose Explore to move points.'}</p>
  </section>;
}
