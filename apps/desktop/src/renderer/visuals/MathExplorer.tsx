import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MathFrame } from '@living-canvas/protocol';
import './math-explorer.css';

const MathStage = lazy(() => import('./MathStage'));
class GraphBoundary extends Component<{ children: ReactNode; onFailure: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure('The graph view could not open. Your diagram is still available.'); }
  render() { return this.state.failed ? null : this.props.children; }
}

interface Props {
  frame?: MathFrame;
  interactive: boolean;
  disabled?: boolean;
  /** Resolves only after teaching and outstanding simulation input have paused. */
  beforeExplore: () => Promise<void>;
  onChange: (values: Record<string, number>) => void;
  onFailure: (message: string) => void;
  children: ReactNode;
}
export default function MathExplorer({ frame, interactive, disabled = false, beforeExplore, onChange, onFailure, children }: Props) {
  const [exploring, setExploring] = useState(false);
  const [pending, setPending] = useState(false);
  const alive = useRef(true), entering = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // Resuming the teacher discards the local view selection. It never changes
  // the accepted board, model state or presentation evidence.
  useEffect(() => { if (!interactive) setExploring(false); }, [interactive]);
  const fail = (message: string) => { setExploring(false); onFailure(message); };
  const explore = async () => {
    if (entering.current || disabled || !frame) return;
    entering.current = true; setPending(true);
    try { await beforeExplore(); if (alive.current) setExploring(true); }
    catch (error) { if (alive.current) fail(error instanceof Error ? error.message : 'Pause the lesson and try Explore graph again.'); }
    finally { entering.current = false; if (alive.current) setPending(false); }
  };
  const showGraph = Boolean(frame && exploring && interactive);
  return <div className="math-explorer">
    {frame && <div className="math-explorer-heading"><div role="group" aria-label="Visual view" className="math-explorer-views">
      <button type="button" className="button secondary compact" aria-pressed={!showGraph} disabled={pending} onClick={() => setExploring(false)}>Diagram</button>
      <button type="button" className="button secondary compact" aria-pressed={showGraph} aria-busy={pending} disabled={disabled || pending} onClick={() => void explore()}>Explore graph</button>
    </div><span>{pending ? 'Pausing teaching…' : showGraph ? 'Drag a point or use the controls below.' : 'Explore pauses teaching so you can try your own changes.'}</span></div>}
    <div className="math-explorer-diagram" hidden={showGraph}>{children}</div>
    {showGraph && frame && <GraphBoundary onFailure={fail}><Suspense fallback={<div className="math-explorer-loading" role="status">Preparing graph…</div>}><MathStage state={frame} interactive={!disabled && interactive} onChange={onChange} onFailure={fail} /></Suspense></GraphBoundary>}
  </div>;
}
