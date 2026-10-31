import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Shape, Text, Arrow, Rect, Group } from 'react-konva';
import Konva from 'konva';
import rough from 'roughjs';
import katex from 'katex';
import { Hand, MousePointer2, Minus, Plus, Maximize, PencilLine, Trash2, ChevronDown } from 'lucide-react';
import type { SceneEntity } from '@living-canvas/protocol';

export type SceneCanvasProps = { entities: SceneEntity[]; fitEntities?: SceneEntity[]; fitKey?: string; onChange: (scene: SceneEntity[]) => void; selected: string[]; onSelect: (ids: string[]) => void; simulation?: boolean; paused?: boolean; onVisible?: (entities: SceneEntity[]) => void; lockedIds?: string[]; timelineControlled?: boolean; cameraOverride?: { x: number; y: number; zoom: number }; highlightedIds?: string[] };
const hash = (text: string) => [...text].reduce((value, char) => ((value << 5) - value + char.charCodeAt(0)) | 0, 42) >>> 0;

function fittedCamera(entities: SceneEntity[], width: number, height: number) {
  if (!entities.length) return { x: 48, y: 64, scale: 1 };
  const corners = entities.flatMap(entity => {
    const fontSize = entity.fontSize ?? 22;
    let left = 0, top = 0;
    let right = entity.width ?? (entity.kind === 'text' ? Math.max(60, (entity.text?.length ?? 0) * fontSize * .65) : 200);
    let bottom = entity.height ?? (entity.kind === 'text' ? fontSize * 1.35 * Math.max(1, (entity.text ?? '').split('\n').length) : 60);
    if (entity.kind === 'circle') { const radius = entity.radius ?? (entity.width ?? 100) / 2; left = top = -radius; right = bottom = radius; }
    else if (entity.kind === 'ellipse') { right = (entity.width ?? 100) / 2; bottom = (entity.height ?? 60) / 2; left = -right; top = -bottom; }
    else if (entity.points?.length) {
      const xs = entity.points.filter((_, index) => index % 2 === 0), ys = entity.points.filter((_, index) => index % 2 === 1);
      left = Math.min(...xs) - 10; right = Math.max(...xs) + 10; top = Math.min(...ys) - 10; bottom = Math.max(...ys) + 10;
    }
    const angle = (entity.rotation ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    return [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => ({ x: entity.x + x * cos - y * sin, y: entity.y + x * sin + y * cos }));
  });
  const minX = Math.min(...corners.map(point => point.x)), minY = Math.min(...corners.map(point => point.y));
  const spanX = Math.max(100, Math.max(...corners.map(point => point.x)) - minX), spanY = Math.max(100, Math.max(...corners.map(point => point.y)) - minY);
  const scale = Math.min(1.5, Math.max(.2, Math.min((width - 64) / spanX, (height - 96) / spanY)));
  return { x: (width - spanX * scale) / 2 - minX * scale, y: 24 + (height - 96 - spanY * scale) / 2 - minY * scale, scale };
}

function RoughEntity({ entity, selected, onSelect, onMove, draggable }: { entity: SceneEntity; selected: boolean; onSelect: () => void; onMove: (x: number, y: number) => void; draggable: boolean }) {
  const drawable = useMemo(() => {
    const generator = rough.generator();
    const options = { seed: hash(entity.id) || 1, stroke: entity.stroke ?? '#18243B', fill: entity.fill === 'transparent' ? undefined : entity.fill, strokeWidth: entity.strokeWidth ?? 1.6, roughness: .65, bowing: .55, fillStyle: 'solid' as const };
    const width = entity.width ?? 100, height = entity.height ?? 60;
    if (entity.kind === 'circle') return generator.circle(0, 0, (entity.radius ?? width / 2) * 2, options);
    if (entity.kind === 'ellipse') return generator.ellipse(0, 0, width, height, options);
    if (entity.kind === 'rect') return generator.rectangle(0, 0, width, height, options);
    if (entity.kind === 'line' || entity.kind === 'path' || entity.kind === 'plot') {
      const points = entity.points ?? [0, 0, width, height];
      const pairs: [number, number][] = [];
      for (let index = 0; index + 1 < points.length; index += 2) pairs.push([points[index], points[index + 1]]);
      return generator.linearPath(pairs, options);
    }
    return null;
  }, [entity]);
  const handlers = { onClick: onSelect, onTap: onSelect, draggable, onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => onMove(event.target.x(), event.target.y()) };
  const base = { x: entity.x, y: entity.y, rotation: entity.rotation ?? 0, opacity: entity.opacity ?? 1, ...handlers };
  if (entity.kind === 'text') return <Text {...base} text={entity.text ?? entity.label ?? ''} fontFamily="DM Sans, sans-serif" fontSize={entity.fontSize ?? 22} fill={entity.fill ?? entity.stroke ?? '#18243B'} width={entity.width} lineHeight={1.35} padding={3} stroke={selected ? '#7775E7' : undefined} strokeWidth={selected ? .3 : 0} />;
  if (entity.kind === 'equation') return <Rect {...base} width={entity.width ?? 200} height={entity.height ?? 48} fill="transparent" stroke={selected ? '#7775E7' : undefined} dash={[4, 4]} />;
  if (entity.kind === 'arrow') return <Arrow {...base} points={entity.points ?? [0, 0, entity.width ?? 100, entity.height ?? 0]} stroke={selected ? '#7775E7' : entity.stroke ?? '#18243B'} fill={entity.stroke ?? '#18243B'} strokeWidth={entity.strokeWidth ?? 1.6} pointerLength={9} pointerWidth={8} hitStrokeWidth={18} />;
  return <Shape {...base} stroke={selected ? '#7775E7' : entity.stroke ?? '#18243B'} strokeWidth={entity.strokeWidth ?? 1.6} hitStrokeWidth={18} fill={entity.fill} sceneFunc={(context, shape) => {
    if (!drawable) return;
    for (const set of drawable.sets) {
      context.beginPath();
      for (const operation of set.ops) {
        const d = operation.data;
        if (operation.op === 'move') context.moveTo(d[0], d[1]);
        else if (operation.op === 'lineTo') context.lineTo(d[0], d[1]);
        else if (operation.op === 'bcurveTo') context.bezierCurveTo(d[0], d[1], d[2], d[3], d[4], d[5]);
      }
      if (set.type === 'fillPath') { context.fillStyle = entity.fill ?? 'transparent'; context.fill(); }
      else { context.strokeStyle = selected ? '#7775E7' : entity.stroke ?? '#18243B'; context.lineWidth = entity.strokeWidth ?? 1.6; context.stroke(); }
    }
    // Shape hit regions are generous enough to select thin marks.
    context.fillStrokeShape(shape);
  }} />;
}

export default function SceneCanvas({ entities, fitEntities, fitKey, onChange, selected, onSelect, simulation, paused, onVisible, lockedIds = [], timelineControlled = false, cameraOverride, highlightedIds = [] }: SceneCanvasProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const fitting = useRef(fitEntities ?? entities); fitting.current = fitEntities ?? entities;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState({ x: 48, y: 64, scale: 1 });
  const viewCamera = cameraOverride ? { x: cameraOverride.x, y: cameraOverride.y, scale: cameraOverride.zoom } : camera;
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [revealState, setRevealState] = useState({ signature: entities.map((entity) => entity.id).join('\0'), count: entities.length });
  const [showObjects, setShowObjects] = useState(false);
  const previous = useRef(new Set(entities.map((entity) => entity.id)));
  const firstScene = useRef(true);
  const lastFitKey = useRef<string | undefined>(undefined);
  const active = entities.find((entity) => selected.includes(entity.id));
  const signature = entities.map((entity) => entity.id).join('\0');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const firstNew = entities.findIndex((entity) => !previous.current.has(entity.id));
  // Derive the first frame from the incoming IDs, before painting or acknowledging it.
  const revealed = timelineControlled ? entities.length : revealState.signature === signature ? Math.min(revealState.count, entities.length) : simulation || paused || reducedMotion ? entities.length : firstNew < 0 ? entities.length : firstNew;
  const visibleCallback = useRef(onVisible); visibleCallback.current = onVisible;
  useLayoutEffect(() => { visibleCallback.current?.(entities.slice(0, revealed)); }, [entities, revealed]);

  useLayoutEffect(() => {
    let previousWidth = 0, previousHeight = 0;
    const update = () => {
      if (!wrapper.current) return;
      const width = wrapper.current.clientWidth, height = wrapper.current.clientHeight;
      if (width <= 0 || height <= 0) return;
      if (previousWidth && previousHeight) {
        const oldWidth = previousWidth, oldHeight = previousHeight;
        const previousFit = fittedCamera(fitting.current, oldWidth, oldHeight).scale;
        const nextFit = fittedCamera(fitting.current, width, height).scale;
        const factor = nextFit / previousFit;
        setCamera((value) => ({ scale: Math.max(.2, Math.min(3, value.scale * factor)), x: width / 2 - (oldWidth / 2 - value.x) * factor, y: height / 2 - 24 - (oldHeight / 2 - 24 - value.y) * factor }));
      }
      previousWidth = width; previousHeight = height; setSize({ width, height });
    };
    update(); const observer = new ResizeObserver(update); if (wrapper.current) observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (entities.length && size.width > 0 && size.height > 0 && (firstScene.current || fitKey !== undefined && fitKey !== lastFitKey.current)) {
      setCamera(fittedCamera(fitEntities ?? entities, size.width, size.height));
      firstScene.current = false;
      lastFitKey.current = fitKey;
    }
  }, [entities, fitEntities, fitKey, size]);

  useEffect(() => {
    const old = previous.current; previous.current = new Set(entities.map((entity) => entity.id));
    if (timelineControlled || paused || simulation || reducedMotion || entities.every((entity) => old.has(entity.id))) { setRevealState({ signature, count: entities.length }); return; }
    let count = entities.findIndex((entity) => !old.has(entity.id)); if (count < 0) count = entities.length;
    setRevealState({ signature, count });
    const batch = Math.max(1, Math.ceil(entities.length / 20));
    const timer = setInterval(() => { count = Math.min(entities.length, count + batch); setRevealState({ signature, count }); if (count >= entities.length) clearInterval(timer); }, 140);
    return () => clearInterval(timer);
  }, [timelineControlled, simulation, paused, reducedMotion, signature]);

  const updateEntity = (id: string, update: Partial<SceneEntity>) => { if (!lockedIds.includes(id)) onChange(entities.map((entity) => entity.id === id ? { ...entity, ...update } : entity)); };
  const move = (dx: number, dy: number) => onChange(entities.map((entity) => selected.includes(entity.id) && !lockedIds.includes(entity.id) ? { ...entity, x: entity.x + dx, y: entity.y + dy } : entity));
  const remove = () => { onChange(entities.filter((entity) => !selected.includes(entity.id) || lockedIds.includes(entity.id))); onSelect([]); };
  const fit = () => {
    setCamera(fittedCamera(fitEntities ?? entities, size.width, size.height));
  };
  const addNote = () => {
    const id = `note-${crypto.randomUUID()}`;
    onChange([...entities, { id, kind: 'text', x: (size.width / 2 - camera.x) / camera.scale, y: (size.height / 2 - camera.y) / camera.scale, text: 'Your note', fontSize: 20, fill: '#5754BD', width: 240, semanticRole: 'learner-note' }]);
    onSelect([id]);
  };

  return <section className="canvas-panel" aria-label="Editable lesson canvas">
    <div className="canvas-topline"><span><span className="tiny-dot" /> Lesson canvas</span><span>{entities.length ? `${entities.length} objects` : 'Room for your next idea'}</span></div>
    <div ref={wrapper} className={`canvas-stage ${tool === 'pan' ? 'panning' : ''}`} tabIndex={0} role="group" aria-label="Canvas. Use the objects list to select a drawing. Arrow keys move selection; Delete removes it." onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      const step = event.shiftKey ? 10 : 1;
      const directions: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (directions[event.key] && selected.length) { event.preventDefault(); move(...directions[event.key]); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected.length) { event.preventDefault(); remove(); }
    }}>
      {!entities.length && <div className="canvas-empty"><OrbitMark /><h3>Your ideas take shape here.</h3><p>As you learn, your teacher will draw,<br />connect ideas, and build experiments.</p></div>}
      <Stage ref={stage} width={size.width} height={size.height} x={viewCamera.x} y={viewCamera.y} scaleX={viewCamera.scale} scaleY={viewCamera.scale} draggable={tool === 'pan'} onDragEnd={(event) => { if (event.target === stage.current) setCamera((value) => ({ ...value, x: event.target.x(), y: event.target.y() })); }} onMouseDown={(event) => { if (event.target === event.target.getStage()) onSelect([]); }} onWheel={(event) => {
        event.evt.preventDefault(); const pointer = stage.current?.getPointerPosition(); if (!pointer) return;
        const scale = Math.min(3, Math.max(.2, camera.scale * (event.evt.deltaY < 0 ? 1.08 : 1 / 1.08)));
        setCamera({ scale, x: pointer.x - (pointer.x - camera.x) / camera.scale * scale, y: pointer.y - (pointer.y - camera.y) / camera.scale * scale });
      }}><Layer><Group>{entities.slice(0, revealed).map((entity) => <RoughEntity key={entity.id} entity={highlightedIds.includes(entity.id) ? { ...entity, stroke: '#7775E7', strokeWidth: Math.min(50, (entity.strokeWidth ?? 1.6) + 1.2) } : entity} selected={selected.includes(entity.id)} onSelect={() => onSelect([entity.id])} onMove={(x, y) => updateEntity(entity.id, { x, y })} draggable={tool === 'select' && !simulation && !lockedIds.includes(entity.id)} />)}</Group></Layer></Stage>
      <div className="equations-layer" aria-hidden="true">{entities.slice(0, revealed).filter((entity) => entity.kind === 'equation').map((entity) => <div key={entity.id} style={{ left: viewCamera.x + entity.x * viewCamera.scale, top: viewCamera.y + entity.y * viewCamera.scale, fontSize: (entity.fontSize ?? 24) * viewCamera.scale, opacity: entity.opacity ?? 1, transformOrigin: '0 0', color: highlightedIds.includes(entity.id) ? '#7775E7' : entity.stroke ?? '#18243B', transform: `rotate(${entity.rotation ?? 0}deg)` }} dangerouslySetInnerHTML={{ __html: katex.renderToString(entity.text ?? '', { throwOnError: false, trust: false, output: 'htmlAndMathml' }) }} />)}</div>
      <div className="canvas-toolbar" aria-label="Canvas tools">
        <button type="button" title="Select and move objects" aria-label="Select and move objects" aria-pressed={tool === 'select'} onClick={() => setTool('select')}><MousePointer2 size={17} /></button>
        <button type="button" title="Pan canvas" aria-label="Pan canvas" aria-pressed={tool === 'pan'} onClick={() => setTool('pan')}><Hand size={17} /></button><i />
        <button type="button" title="Add your note" aria-label="Add your note" onClick={addNote}><PencilLine size={17} /></button><i />
        <button type="button" title="Zoom out" aria-label="Zoom out" disabled={camera.scale <= .2} onClick={() => setCamera((value) => ({ ...value, scale: Math.max(.2, value.scale - .1) }))}><Minus size={16} /></button>
        <span className="zoom-value">{Math.round(camera.scale * 100)}%</span>
        <button type="button" title="Zoom in" aria-label="Zoom in" disabled={camera.scale >= 3} onClick={() => setCamera((value) => ({ ...value, scale: Math.min(3, value.scale + .1) }))}><Plus size={16} /></button>
        <button type="button" title="Fit drawing to canvas" aria-label="Fit drawing to canvas" onClick={fit}><Maximize size={16} /></button>
      </div>
    </div>
    <div className="canvas-access"><button type="button" className="text-button" aria-expanded={showObjects} onClick={() => setShowObjects(!showObjects)}>Canvas objects <ChevronDown size={13} /></button><span>Scroll to zoom · drag to explore</span></div>
    {showObjects && <div className="object-list" aria-label="Canvas objects">{entities.length ? entities.map((entity) => <button type="button" key={entity.id} className={selected.includes(entity.id) ? 'selected' : ''} onClick={() => { onSelect([entity.id]); wrapper.current?.focus(); }}>{entity.label ?? entity.text ?? `${entity.kind} ${entity.id.slice(0, 10)}`}</button>) : <p>No objects yet. Add a note or begin a lesson.</p>}</div>}
    {active && <div className="object-inspector"><strong>{lockedIds.includes(active.id) ? 'Experiment object · use its controls' : active.kind === 'text' ? 'Edit note' : active.label ?? active.kind}</strong>{(active.kind === 'text' || active.kind === 'equation') && <input aria-label="Selected object text" disabled={lockedIds.includes(active.id)} value={active.text ?? ''} onChange={(event) => updateEntity(active.id, { text: event.target.value })} />}<label>X <input type="number" aria-label="Object X position" disabled={lockedIds.includes(active.id)} value={Math.round(active.x)} onChange={(event) => updateEntity(active.id, { x: Number(event.target.value) })} /></label><label>Y <input type="number" aria-label="Object Y position" disabled={lockedIds.includes(active.id)} value={Math.round(active.y)} onChange={(event) => updateEntity(active.id, { y: Number(event.target.value) })} /></label><button type="button" className="icon-button danger-text" title="Delete selected object" aria-label="Delete selected object" disabled={lockedIds.includes(active.id)} onClick={remove}><Trash2 size={15} /></button></div>}
  </section>;
}

export function OrbitMark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'orbit-mark small' : 'orbit-mark'} width="150" height="118" viewBox="0 0 150 118" fill="none" aria-hidden="true"><path d="M27 72C10 46 57 19 97 30c36 10 43 37 13 54C81 102 37 95 27 72Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="M29 73C13 47 57 22 98 31c37 9 42 35 14 52" stroke="currentColor" strokeWidth=".8" strokeLinecap="round" /><path d="M42 29C59 8 89 14 98 47c9 33-5 59-25 54-21-6-30-47-20-71" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="112" cy="47" r="11" fill="#C3E9D7" stroke="currentColor" strokeWidth="1.5" /><path d="m75 50 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z" fill="#7775E7" /></svg>;
}
