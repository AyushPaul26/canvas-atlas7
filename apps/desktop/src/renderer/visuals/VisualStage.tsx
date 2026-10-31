import { Component, lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { spatialSceneSchema } from '@living-canvas/protocol';
import type { SceneEntity } from '@living-canvas/protocol';
import type { VisualFrame } from '@living-canvas/scene';
import SceneCanvas from '../SceneCanvas';
import type { SceneCanvasProps } from '../SceneCanvas';

const Scene3D = lazy(() => import('./Scene3D'));
export type VisualStageMode = '2d' | '3d' | 'fallback';
export type VisualStageProps = Omit<SceneCanvasProps, 'entities' | 'timelineControlled' | 'cameraOverride' | 'highlightedIds'> & { frame: VisualFrame; interactionEnabled?:boolean;viewKey?:string;onReady?: (mode: VisualStageMode) => void; onFailure?: (message: string) => void };
class SpatialBoundary extends Component<{ children: ReactNode; onFailure: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(cause: Error) { this.props.onFailure(cause.message); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function VisualStage({ frame, interactionEnabled=false,viewKey=frame.fitKey,onReady, onFailure, onVisible, ...canvasProps }: VisualStageProps) {
  const callbacks = useRef({ onReady, onFailure, onVisible }); callbacks.current = { onReady, onFailure, onVisible };
  const sceneKey = frame.spatialScene ? `${frame.spatialScene.fallbackDescription}:${frame.spatialScene.nodes.map(node => `${node.id}:${node.kind}`).join('|')}` : '';
  const [failureState, setFailure] = useState<{ key: string; message: string }>();
  const [spatialReadyKey, setSpatialReady] = useState<string>();
  const failure = failureState?.key === sceneKey ? failureState.message : undefined;
  const spatialReady = spatialReadyKey === sceneKey;
  const boardReady = useRef(false), reported = useRef<{ frame: VisualFrame; mode: VisualStageMode } | undefined>(undefined);
  const checked = frame.spatialScene ? spatialSceneSchema.safeParse(frame.spatialScene) : undefined;
  const invalid = checked && !checked.success ? 'The spatial view could not be read.' : undefined;
  const scene = checked?.success ? frame.spatialScene : undefined;
  const mode: VisualStageMode = frame.spatialScene ? failure || invalid ? 'fallback' : '3d' : '2d';
  const acknowledge = useCallback((next: VisualStageMode) => {
    if (boardReady.current && (reported.current?.frame !== frame || reported.current.mode !== next)) { reported.current = { frame, mode: next }; callbacks.current.onReady?.(next); }
  }, [frame]);
  const fail = useCallback((message: string) => { setFailure({ key: sceneKey, message }); callbacks.current.onFailure?.(message); }, [sceneKey]);
  const ready = useCallback(() => { setSpatialReady(sceneKey); }, [sceneKey]);
  const visible = useCallback((entities: SceneEntity[]) => { boardReady.current = true; callbacks.current.onVisible?.(entities); }, []);
  useLayoutEffect(() => { if (invalid) callbacks.current.onFailure?.(invalid); }, [invalid]);
  useLayoutEffect(() => { if (mode !== '3d' || spatialReady) acknowledge(mode); }, [mode, spatialReady, frame, acknowledge]);
  return <div className="visual-stage" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, gap: 8 }}>
    {scene && !failure && <div className="spatial-view-card" style={{ border: '1px solid var(--border)', borderRadius: 15, overflow: 'hidden', background: 'var(--paper)',flexShrink:0 }}>
      <SpatialBoundary key={sceneKey} onFailure={fail}><Suspense fallback={<p role="status" style={{ padding: 16 }}>Preparing spatial view…</p>}><Scene3D scene={scene} styles={frame.spatialStyles} camera={frame.camera} interactionEnabled={interactionEnabled} viewKey={viewKey} onReady={ready} onFailure={fail} /></Suspense></SpatialBoundary>
    </div>}
    {frame.spatialScene && <p role={mode === 'fallback' ? 'status' : undefined} style={{ margin: 0, color: 'var(--muted)', fontSize: 12, lineHeight: 1.5,flexShrink:0 }}>{mode === 'fallback' && 'Showing the diagram. '}{frame.spatialScene.fallbackDescription}</p>}
    <SceneCanvas {...canvasProps} entities={frame.entities} fitEntities={frame.fitEntities} fitKey={frame.fitKey} timelineControlled cameraOverride={frame.camera} highlightedIds={frame.highlightedIds} onVisible={visible} />
  </div>;
}
