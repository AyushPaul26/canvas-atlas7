import { adaptTeachingBeat, controlSchema, visualCueSchema } from '../../protocol/src/index';
import type { PlaybackCursor, SceneEntity, SpatialScene, TeachingBeat, VisualCue } from '../../protocol/src/index';

export type VisualCamera = { x: number; y: number; zoom: number };
export type VisualBaseline = { entities: SceneEntity[]; camera?: VisualCamera; reducedMotion?: boolean; chunkDurations?: Record<string, number> };
export type VisualPlaybackFrame = { cursor: PlaybackCursor; progress: number; durationSeconds: number; offsetSeconds: number; estimated?: boolean };
export type VisualFrame = {
  entities: SceneEntity[]; fitEntities?: SceneEntity[]; fitKey?: string; camera?: VisualCamera; spatialScene?: SpatialScene;
  spatialStyles: Record<string, { visible: boolean; opacity: number; highlighted: boolean }>;
  highlightedIds: string[]; appliedCueIds: string[]; completedCueIds: string[]; invalidCueIds: string[];
  experimentValues: Record<string, number | string | boolean>;
  experimentCues: Array<{ id: string; controlId: string; value: number | string | boolean }>;
  simulationTargetTick: number;
};
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const threshold = (at: VisualCue['at']) => at === 'start' ? 0 : at === 'end' ? 1 : at;
const estimateDuration = (text: string) => Math.max(.4, text.trim().split(/\s+/).length / 2.6);
function validTween(action: VisualCue['action'], spatial: boolean): boolean {
  if (action.type !== 'tween') return true;
  const range = action.property === 'opacity' ? [0, 1] : action.property === 'radius' ? [0, 100000] : action.property === 'strokeWidth' ? [0, 50] : action.property === 'fontSize' ? [1, 300] : [-1_000_000, 1_000_000];
  if (![action.from, action.to].every(value => value >= range[0] && value <= range[1])) return false;
  if (!spatial) return true;
  if (action.property === 'fontSize' || action.property === 'strokeWidth') return false;
  if (['width', 'height', 'radius'].includes(action.property)) return [action.from, action.to].every(value => value > 0 && value <= (action.property === 'radius' ? 5000 : 10000));
  return true;
}

/** Distance-weighted sampling keeps unequal path segments at a uniform speed. */
function pathPosition(points: Extract<VisualCue['action'], { type: 'path' }>['points'], amount: number): { x: number; y: number } {
  if (amount <= 0) return points[0];
  if (amount >= 1) return points[points.length - 1];
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * amount;
  for (const [index, length] of lengths.entries()) {
    if (length === 0) continue;
    if (remaining <= length) {
      const from = points[index], to = points[index + 1], progress = remaining / length;
      return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
    }
    remaining -= length;
  }
  return points[points.length - 1];
}

/** Recompute from the immutable accepted board. No timers, accumulated deltas or renderer effects. */
export function evaluateVisualFrame(beat: TeachingBeat, position: PlaybackCursor | VisualPlaybackFrame, baseline: SceneEntity[] | VisualBaseline): VisualFrame {
  const base = Array.isArray(baseline) ? { entities: baseline } : baseline;
  const accepted = adaptTeachingBeat(beat);
  const cursor = 'cursor' in position ? position.cursor : position;
  const current = accepted.chunks.findIndex(chunk => chunk.id === cursor.chunkId);
  const entities = new Map(base.entities.map(entity => [entity.id, structuredClone(entity)]));
  // The baseline is authoritative for existing IDs: replay must preserve learner edits and notes.
  for (const entity of beat.canvas.entities) if (!entities.has(entity.id)) entities.set(entity.id, structuredClone(entity));
  const fitEntities = [...entities.values()].map(entity => structuredClone(entity));
  // Include hidden reveals and motion endpoints in the initial viewport.
  for (const cue of accepted.cues) if (cue.action.type === 'tween') {
    const action = cue.action, entity = entities.get(action.targetId);
    if (entity && validTween(action, false)) fitEntities.push({ ...entity, [action.property]: action.from }, { ...entity, [action.property]: action.to });
  }
  const spatialScene = beat.spatialScene ? structuredClone(beat.spatialScene) : undefined;
  const spatial = new Map(spatialScene?.nodes.map(node => [node.id, node]));
  const visible = new Map([...entities.keys()].map(id => [id, true]));
  const spatialStyles: VisualFrame['spatialStyles'] = Object.fromEntries([...spatial.keys()].map(id => [id, { visible: true, opacity: 1, highlighted: false }]));
  const highlighted = new Set<string>();
  const frame: VisualFrame = { entities: [], fitEntities, fitKey: beat.id, spatialStyles, highlightedIds: [], appliedCueIds: [], completedCueIds: [], invalidCueIds: [], experimentValues: {}, experimentCues: [], simulationTargetTick: 0, ...(base.camera ? { camera: { ...base.camera } } : {}), ...(spatialScene ? { spatialScene } : {}) };
  const durations = accepted.chunks.map((chunk, index) => {
    const observed = base.chunkDurations?.[chunk.id];
    if (index === current && 'durationSeconds' in position && position.durationSeconds > 0) return position.durationSeconds;
    return observed !== undefined && Number.isFinite(observed) && observed > 0 ? observed : estimateDuration(chunk.text);
  });
  const starts = durations.map((_, index) => durations.slice(0, index).reduce((a, b) => a + b, 0));
  const progress = current < 0 ? -1 : 'progress' in position ? clamp(finite(position.progress, 0)) : clamp(finite(cursor.offsetSeconds, 0) / durations[current]);
  const offset = current < 0 ? 0 : 'durationSeconds' in position && position.durationSeconds > 0 ? progress * durations[current] : Math.max(0, finite(cursor.offsetSeconds, 0));
  const elapsed = current < 0 ? 0 : starts[current] + offset;
  frame.simulationTargetTick = Math.min(36000, Math.floor(elapsed * 60));
  const cues: Array<{ cue: VisualCue; chunk: number; at: number; order: number }> = [];
  for (const [order, raw] of accepted.cues.entries()) {
    const checked = visualCueSchema.safeParse(raw);
    const chunk = accepted.chunks.findIndex(item => item.id === raw.chunkId);
    const action = raw.action;
    const validControl = action.type !== 'experiment' || beat.simulation?.controls.some(control => control.id === action.controlId && controlSchema.safeParse({ ...control, value: action.value }).success);
    // Learner annotations are deliberately outside the teacher's cue layer.
    const validTarget = !('targetId' in action) || (entities.has(action.targetId) && entities.get(action.targetId)?.semanticRole !== 'learner-note') || spatial.has(action.targetId);
    const validPath = action.type !== 'path' || entities.has(action.targetId) && entities.get(action.targetId)?.semanticRole !== 'learner-note' && !spatial.has(action.targetId);
    if (!checked.success || chunk < 0 || !validControl || !validTarget || !validPath || !validTween(action, 'targetId' in action && spatial.has(action.targetId))) { frame.invalidCueIds.push(raw.id); continue; }
    cues.push({ cue: checked.data, chunk, at: threshold(raw.at), order });
  }
  cues.sort((a, b) => a.chunk - b.chunk || a.at - b.at || a.order - b.order);
  const firstPath = new Set<string>();
  for (const { cue } of cues) if (cue.action.type === 'path') {
    const action = cue.action, entity = entities.get(action.targetId)!;
    fitEntities.push(...action.points.map(point => ({ ...entity, x: point.x, y: point.y })));
    // Future motion starts at its first accepted pose rather than jumping from
    // unrelated baseline coordinates when its narration sentence begins.
    if (!firstPath.has(action.targetId)) { firstPath.add(action.targetId); Object.assign(entity, action.points[0]); }
  }
  const firstVisibility = new Set<string>();
  for (const { cue } of cues) if (cue.action.type === 'visibility' && !firstVisibility.has(cue.action.targetId)) {
    firstVisibility.add(cue.action.targetId);
    // A future reveal starts hidden. An initial hide retains the accepted initial pose.
    if (cue.action.visible) {
      visible.set(cue.action.targetId, false);
      if (spatialStyles[cue.action.targetId]) spatialStyles[cue.action.targetId].visible = false;
    }
  }
  for (const { cue, chunk, at } of cues) {
    if (cursor.beatId !== beat.id || current < chunk || current === chunk && progress < at) continue;
    const action = cue.action;
    const ageMs = Math.max(0, (elapsed - starts[chunk] - at * durations[chunk]) * 1000);
    frame.appliedCueIds.push(cue.id);
    const amount = 'durationMs' in action && action.durationMs > 0 && !base.reducedMotion ? clamp(ageMs / action.durationMs) : 1;
    if (amount >= 1) frame.completedCueIds.push(cue.id);
    if (action.type === 'visibility') {
      visible.set(action.targetId, action.visible);
      if (spatialStyles[action.targetId]) spatialStyles[action.targetId].visible = action.visible;
    } else if (action.type === 'highlight') {
      if (action.active) highlighted.add(action.targetId); else highlighted.delete(action.targetId);
      if (spatialStyles[action.targetId]) spatialStyles[action.targetId].highlighted = action.active;
    } else if (action.type === 'tween') {
      const value = amount === 1 ? action.to : action.from + (action.to - action.from) * amount;
      const entity = entities.get(action.targetId);
      if (entity) Object.assign(entity, { [action.property]: value });
      const node = spatial.get(action.targetId);
      if (node) {
        if (action.property === 'x') node.position[0] = value;
        if (action.property === 'y') node.position[1] = value;
        if (action.property === 'rotation') { node.rotation ??= [0, 0, 0]; node.rotation[2] = value * Math.PI / 180; }
        if (action.property === 'opacity') spatialStyles[node.id].opacity = value;
        if (action.property === 'width') { node.scale ??= [1, 1, 1]; node.scale[0] = value; }
        if (action.property === 'height') { node.scale ??= [1, 1, 1]; node.scale[1] = value; }
        if (action.property === 'radius') node.scale = [value * 2, value * 2, value * 2];
      }
    } else if (action.type === 'path') {
      Object.assign(entities.get(action.targetId)!, pathPosition(action.points, amount));
    } else if (action.type === 'camera') {
      const previous = frame.camera ?? { x: 0, y: 0, zoom: 1 };
      frame.camera = { x: previous.x + (action.x - previous.x) * amount, y: previous.y + (action.y - previous.y) * amount, zoom: previous.zoom + (action.zoom - previous.zoom) * amount };
    } else if (action.type === 'experiment') {
      frame.experimentValues[action.controlId] = action.value;
      frame.experimentCues.push({ id: cue.id, controlId: action.controlId, value: action.value });
    }
  }
  frame.entities = [...entities.values()].filter(entity => visible.get(entity.id) !== false);
  frame.highlightedIds = [...highlighted];
  return frame;
}
