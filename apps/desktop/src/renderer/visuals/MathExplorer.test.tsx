// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MathFrame } from '@living-canvas/protocol';
vi.mock('./MathStage', () => ({ default: ({ onChange }: { onChange: (values: Record<string, number>) => void }) => <button onClick={() => onChange({ x: 2, y: 3 })}>Drag both axes</button> }));
import MathExplorer from './MathExplorer';
const frame: MathFrame = { kind: 'math', bounds: { left: -5, right: 5, bottom: -5, top: 5 }, axes: {}, tick: 0, time: 0, controls: [], points: [], curves: [], vectors: [] };
afterEach(cleanup);
it('waits for the pause/settle barrier before replacing the diagram with an explorable graph', async () => {
  let resolve!: () => void;
  const beforeExplore = vi.fn(() => new Promise<void>(done => { resolve = done; }));
  const onChange = vi.fn();
  render(<MathExplorer frame={frame} interactive beforeExplore={beforeExplore} onChange={onChange} onFailure={vi.fn()}><p>Canonical diagram</p></MathExplorer>);
  fireEvent.click(screen.getByRole('button', { name: 'Explore graph' }));
  expect(beforeExplore).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Drag both axes' })).toBeNull();
  await act(async () => { resolve(); });
  fireEvent.click(await screen.findByRole('button', { name: 'Drag both axes' }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ x: 2, y: 3 });
  fireEvent.click(screen.getByRole('button', { name: 'Diagram' }));
  expect(screen.getByText('Canonical diagram').closest('[hidden]')).toBeNull();
});
it('retains the diagram and reports a failed pause rather than entering an active graph', async () => {
  const failure = vi.fn();
  render(<MathExplorer frame={frame} interactive beforeExplore={async () => { throw new Error('The lesson changed'); }} onChange={vi.fn()} onFailure={failure}><p>Canonical diagram</p></MathExplorer>);
  fireEvent.click(screen.getByRole('button', { name: 'Explore graph' }));
  await waitFor(() => expect(failure).toHaveBeenCalledWith('The lesson changed'));
  expect(screen.queryByRole('button', { name: 'Drag both axes' })).toBeNull();
  expect(screen.getByText('Canonical diagram').closest('[hidden]')).toBeNull();
});
