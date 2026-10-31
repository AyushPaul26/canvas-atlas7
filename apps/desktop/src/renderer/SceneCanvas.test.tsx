// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneEntity } from '@living-canvas/protocol';
const resizing = vi.hoisted(() => ({ update: () => {} }));

vi.mock('react-konva', () => {
  const Surface = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Stage: Surface, Layer: Surface, Shape: Surface, Text: Surface, Arrow: Surface, Rect: Surface, Group: Surface };
});
import SceneCanvas from './SceneCanvas';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { constructor(update: () => void) { resizing.update = update; } observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const object = (id: string): SceneEntity => ({ id, kind: 'text', x: 10, y: 10, text: id });

describe('revealed scene acknowledgements', () => {
  it('never acknowledges new board objects using the previous board reveal count', () => {
    const visible: string[][] = [];
    const props = { onChange: vi.fn(), selected: [], onSelect: vi.fn(), onVisible: (entities: SceneEntity[]) => visible.push(entities.map((entity) => entity.id)) };
    const view = render(<SceneCanvas {...props} entities={[object('old')]} />);
    expect(visible.at(-1)).toEqual(['old']);
    const before = visible.length;
    const board = [object('new-a'), object('new-b'), object('new-c')];
    view.rerender(<SceneCanvas {...props} entities={board} />);
    expect(visible[before]).toEqual([]);
    act(() => vi.advanceTimersByTime(140));
    expect(visible.at(-1)).toEqual(['new-a']);
    // A transcript or selection rerender with the same IDs must not reveal future marks.
    view.rerender(<SceneCanvas {...props} entities={[...board]} selected={['new-a']} />);
    expect(visible.at(-1)).toEqual(['new-a']);
    act(() => vi.advanceTimersByTime(280));
    expect(visible.at(-1)).toEqual(['new-a', 'new-b', 'new-c']);
  });
});

it('renders timeline-controlled frames immediately and retains equation opacity/transforms', () => {
  const onVisible = vi.fn();
  const props = { onChange: vi.fn(), selected: [], onSelect: vi.fn(), onVisible, timelineControlled: true, cameraOverride: { x: 5, y: 7, zoom: 2 } };
  const view = render(<SceneCanvas {...props} entities={[object('old')]} />);
  const equation: SceneEntity = { id: 'eq', kind: 'equation', x: 10, y: 20, text: 'x^2', opacity: .25, rotation: 30 };
  view.rerender(<SceneCanvas {...props} entities={[equation]} />);
  expect(onVisible.mock.calls.at(-1)?.[0]).toEqual([equation]);
  const overlay = view.container.querySelector('.equations-layer > div') as HTMLDivElement;
  expect(overlay.style.opacity).toBe('0.25'); expect(overlay.style.left).toBe('25px'); expect(overlay.style.top).toBe('47px'); expect(overlay.style.transformOrigin).toBe('0 0');
});

it('fits the first drawing to its actual bounds so compact-window equations remain legible', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(520);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(260);
  const view = render(<SceneCanvas entities={[
    { id: 'body', kind: 'circle', x: 270, y: 300, radius: 42 },
    { id: 'equation', kind: 'equation', x: 300, y: 340, text: 'F=ma', fontSize: 28, width: 180, height: 48 },
  ]} onChange={vi.fn()} selected={[]} onSelect={vi.fn()} timelineControlled />);
  const equation = view.container.querySelector('.equations-layer > div') as HTMLDivElement;
  expect(parseFloat(equation.style.fontSize)).toBeGreaterThanOrEqual(24);
  expect(parseFloat(equation.style.left)).toBeGreaterThan(0);
  expect(parseFloat(equation.style.top)).toBeGreaterThan(0);
});

it('restores readable scale when space returns after a temporary spatial view', () => {
  let height = 300;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(520);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  const view = render(<SceneCanvas entities={[
    { id: 'body', kind: 'circle', x: 270, y: 300, radius: 42 },
    { id: 'equation', kind: 'equation', x: 300, y: 420, text: 'F=ma', fontSize: 28, width: 180, height: 48 },
  ]} onChange={vi.fn()} selected={[]} onSelect={vi.fn()} timelineControlled />);
  const equation = view.container.querySelector('.equations-layer > div') as HTMLDivElement;
  const initial = parseFloat(equation.style.fontSize);
  act(() => { height = 200; resizing.update(); });
  expect(parseFloat(equation.style.fontSize)).toBeLessThan(initial);
  act(() => { height = 300; resizing.update(); });
  expect(parseFloat(equation.style.fontSize)).toBeCloseTo(initial);
});

it('refits a new accepted step and keeps its equation above the floating tools', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(520);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
  const props = { onChange: vi.fn(), selected: [], onSelect: vi.fn(), timelineControlled: true };
  const view = render(<SceneCanvas {...props} fitKey="first" entities={[{ id: 'eq', kind: 'equation', x: 0, y: 0, width: 100, height: 48, fontSize: 28, text: 'F=ma' }]} />);
  view.rerender(<SceneCanvas {...props} fitKey="second" entities={[{ id: 'eq-2', kind: 'equation', x: 1000, y: 1000, width: 200, height: 48, fontSize: 28, text: 'F=ma' }]} />);
  const equation = view.container.querySelector('.equations-layer > div') as HTMLDivElement;
  expect(parseFloat(equation.style.left)).toBeGreaterThanOrEqual(24);
  expect(parseFloat(equation.style.left)).toBeLessThan(300);
  expect(parseFloat(equation.style.top) + parseFloat(equation.style.fontSize) * 1.5).toBeLessThan(228);
});

it('uses the previous viewport origin when React batches a wider resize', () => {
  let width = 520, height = 260;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  const view = render(<SceneCanvas entities={[
    { id: 'eq', kind: 'equation', x: 200, y: 300, width: 200, height: 48, fontSize: 28, text: 'F=ma' },
    { id: 'extent', kind: 'rect', x: 600, y: 500, width: 200, height: 48 },
  ]} onChange={vi.fn()} selected={[]} onSelect={vi.fn()} timelineControlled />);
  act(() => { width = 900; height = 460; resizing.update(); });
  const equation = view.container.querySelector('.equations-layer > div') as HTMLDivElement;
  expect(parseFloat(equation.style.left)).toBeGreaterThanOrEqual(24);
  expect(parseFloat(equation.style.top)).toBeGreaterThanOrEqual(24);
});
