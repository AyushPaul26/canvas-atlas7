// @vitest-environment jsdom
import React from 'react';
import JXG from 'jsxgraph';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MathFrame } from '@living-canvas/protocol';
import MathStage from './MathStage';

const fixture = (): MathFrame => ({ kind: 'math', bounds: { left: -5, right: 5, bottom: -5, top: 5 }, axes: { xLabel: 'Distance', yLabel: 'Height' }, tick: 0, time: 0, controls: [{ id: 'px', min: -3, max: 3, step: .5 }, { id: 'py', min: -3, max: 3, step: .5 }], points: [{ id: 'p', label: 'Moving point', x: 1, y: 2, drag: { xControl: 'px', yControl: 'py' } }], curves: [{ id: 'line', label: 'Relationship', segments: [[[-2, -2], [0, 0], [2, 2]]] }], vectors: [{ id: 'v', from: [0, 0], to: [1, 2], label: 'Position' }] });
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360, toJSON: () => ({}) });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('trusted interactive maths view', () => {
  it('draws numeric SVG primitives and escapes model labels without loading remote resources', () => {
    const state = fixture(); state.points[0].label = '<img src="https://unsafe.invalid/pixel" onerror="alert(1)">';
    const onFailure = vi.fn();
    const view = render(<MathStage state={state} interactive onChange={vi.fn()} onFailure={onFailure} />);
    expect(onFailure).not.toHaveBeenCalled();
    expect(view.container.querySelector('svg')).not.toBeNull();
    expect(view.container.querySelector('svg circle,svg ellipse')).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Maths graph' })).toBeTruthy();
    expect(view.container.querySelector('img,script')).toBeNull();
    // JSXGraph reserves a hidden, empty foreignObject even for its SVG-only renderer.
    expect(view.container.querySelector('foreignObject')?.childElementCount ?? 0).toBe(0);
    expect(screen.getByText(state.points[0].label!).textContent).toContain('onerror');
    expect(screen.getByText('Distance')).toBeTruthy();
  });
  it('provides keyboard coordinate controls with clamping and snapping', () => {
    const onChange = vi.fn(); render(<MathStage state={fixture()} interactive onChange={onChange} />);
    const x = screen.getByRole('spinbutton', { name: 'Moving point x' });
    fireEvent.change(x, { target: { value: '2.26' } }); fireEvent.blur(x);
    expect(onChange).toHaveBeenLastCalledWith({ px: 2.5 });
    fireEvent.change(x, { target: { value: '100' } }); fireEvent.keyDown(x, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith({ px: 3 });
  });
  it('does not permit interaction during teaching and frees its board when unmounted', () => {
    const before = Object.keys(JXG.boards as object).length;
    const onChange = vi.fn(); const view = render(<MathStage state={fixture()} interactive={false} onChange={onChange} />);
    const field = screen.getByRole('spinbutton', { name: 'Moving point x' }) as HTMLInputElement;
    expect(field.disabled).toBe(true);
    fireEvent.change(field, { target: { value: '3' } }); fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
    expect(Object.keys(JXG.boards as object).length).toBe(before + 1);
    view.unmount(); expect(Object.keys(JXG.boards as object).length).toBe(before);
  });
  it('restores accepted coordinates after a rejected input and lets the learner retry', () => {
    const state = fixture(), onChange = vi.fn();
    const view = render(<MathStage state={state} interactive onChange={onChange} />);
    const x = screen.getByRole('spinbutton', { name: 'Moving point x' }) as HTMLInputElement;
    fireEvent.change(x, { target: { value: '2' } }); fireEvent.blur(x);
    expect(onChange).toHaveBeenCalledTimes(1);
    view.rerender(<MathStage state={state} interactive={false} onChange={onChange} />);
    expect(x.value).toBe('1');
    view.rerender(<MathStage state={state} interactive onChange={onChange} />);
    fireEvent.change(x, { target: { value: '2' } }); fireEvent.blur(x);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
  it('commits one snapped point drag on release and removes drag handlers with the board', () => {
    const onChange = vi.fn(); const view = render(<MathStage state={fixture()} interactive onChange={onChange} />);
    const board = Object.values(JXG.boards as Record<string, JXG.Board>).at(-1)!;
    const point = Object.values(board.objects).find(object => (object as JXG.Point).elType === 'point' && (object as JXG.Point).getAttribute('size') === 5 && (object as JXG.Point).X() === 1 && (object as JXG.Point).Y() === 2) as JXG.Point & { triggerEventHandlers: (events: string[], args: unknown[]) => void };
    point.setPosition(JXG.COORDS_BY_USER, [2.26, -100]);
    point.triggerEventHandlers(['drag'], []);
    expect(onChange).not.toHaveBeenCalled();
    point.triggerEventHandlers(['up'], []);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ px: 2.5, py: -3 });
    expect([point.X(), point.Y()]).toEqual([1, 2]);
    view.unmount();
    expect(Object.values(JXG.boards as Record<string, JXG.Board>)).not.toContain(board);
  });
  it('rejects an invalid numeric frame and reports a recoverable drawing failure', () => {
    const state = fixture(); state.points[0].x = NaN;
    const onFailure = vi.fn(); const view = render(<MathStage state={state} interactive onChange={vi.fn()} onFailure={onFailure} />);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('svg')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/diagram/i);
  });
});
