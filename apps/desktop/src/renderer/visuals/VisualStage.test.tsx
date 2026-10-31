// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisualFrame } from '@living-canvas/scene';
const harness = vi.hoisted(() => ({ fail: false,spatialProps:undefined as undefined|{interactionEnabled?:boolean;viewKey?:string} }));
vi.mock('../SceneCanvas', () => ({ default: ({ entities, timelineControlled, onVisible }: { entities: Array<{ id: string }>; timelineControlled?: boolean; onVisible?: (entities: unknown[]) => void }) => { React.useLayoutEffect(() => { onVisible?.(entities); }, [entities, onVisible]); return <div data-testid="board" data-timeline={String(timelineControlled)}>{entities.map(e => <span key={e.id}>{e.id}</span>)}</div>; } }));
vi.mock('./Scene3D', () => ({ default: ({ onReady, onFailure,...props }: { onReady?: () => void; onFailure?: (error: string) => void;interactionEnabled?:boolean;viewKey?:string }) => { harness.spatialProps=props;React.useEffect(() => { if (harness.fail) onFailure?.('WebGL2 unavailable'); else onReady?.(); }, [onReady, onFailure]); return <button onClick={() => onFailure?.('The 3D context was lost')}>Lose context</button>; } }));
import VisualStage from './VisualStage';
const frame = (spatial = false): VisualFrame => ({ entities: [{ id: 'explanation', kind: 'text', x: 0, y: 0, text: 'A vector has direction and size' }], spatialStyles: {}, appliedCueIds: [], completedCueIds: [], invalidCueIds: [], highlightedIds: [], experimentValues: {}, experimentCues: [], simulationTargetTick: 0, ...(spatial ? { spatialScene: { nodes: [{ id: 'vector', kind: 'arrow' as const, position: [0, 0, 0] as [number,number,number], material: 'blue' as const }], camera: { position: [3,3,5] as [number,number,number], target: [0,0,0] as [number,number,number] }, fallbackDescription: 'The arrow points right. Its length shows magnitude.' } } : {}) });
afterEach(() => { cleanup(); harness.fail = false;harness.spatialProps=undefined; });
const props = { selected: [], onSelect: vi.fn(), onChange: vi.fn() };
describe('visual presentation readiness', () => {
  it('acknowledges a painted 2D board without starting a reveal timer', async () => {
    const onReady = vi.fn(); render(<VisualStage {...props} frame={frame()} onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledWith('2d'));
    expect(screen.getByTestId('board').getAttribute('data-timeline')).toBe('true');
  });
  it('makes the explanatory board available when WebGL is unavailable', async () => {
    harness.fail = true; const onReady = vi.fn(), onFailure = vi.fn();
    render(<VisualStage {...props} frame={frame(true)} onReady={onReady} onFailure={onFailure} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledWith('fallback'));
    expect(onFailure).toHaveBeenCalledWith('WebGL2 unavailable');
    expect(screen.getByText(/The arrow points right. Its length shows magnitude/)).toBeTruthy(); expect(screen.getByText('explanation')).toBeTruthy();
  });
  it('switches to the explanation after losing an established 3D context', async () => {
    const onReady = vi.fn(), onFailure = vi.fn(); render(<VisualStage {...props} frame={frame(true)} onReady={onReady} onFailure={onFailure} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledWith('3d'));
    await act(async () => { fireEvent.click(screen.getByText('Lose context')); });
    expect(onFailure).toHaveBeenCalledWith('The 3D context was lost'); expect(onReady).toHaveBeenLastCalledWith('fallback');
    expect(screen.queryByText('Lose context')).toBeNull();
  });
  it('passes explicit exploration state and stable beat identity without affecting presentation readiness',async()=>{
    const value={...frame(true),fitKey:'accepted-beat'},onReady=vi.fn();const view=render(<VisualStage {...props} frame={value} onReady={onReady}/>);
    await waitFor(()=>expect(onReady).toHaveBeenCalledWith('3d'));expect(harness.spatialProps).toMatchObject({interactionEnabled:false,viewKey:'accepted-beat'});
    view.rerender(<VisualStage {...props} frame={value} interactionEnabled viewKey="another-view" onReady={onReady}/>);
    expect(harness.spatialProps).toMatchObject({interactionEnabled:true,viewKey:'another-view'});expect(screen.getByTestId('board').getAttribute('data-timeline')).toBe('true');
  });
});
