import { describe, expect, it } from 'vitest';
import type { PlaybackCursor, SceneEntity, TeachingBeat, VisualCue } from '../../packages/protocol/src/index';
import { evaluateVisualFrame } from '../../packages/scene/src/timeline';

const entities: SceneEntity[] = [{ id: 'equation', kind: 'equation', x: 10, y: 20, text: 'F=ma', opacity: 1 }, { id: 'arrow', kind: 'arrow', x: 40, y: 20 }];
const cue = (id: string, chunkId: string, at: VisualCue['at'], action: VisualCue['action']): VisualCue => ({ id, chunkId, at, action });
const beat: TeachingBeat = { id: 'beat', narration: 'First. Second.', chunks: [{ id: 'first', text: 'First. ' }, { id: 'second', text: 'Second.' }], canvas: { mode: 'replace', entities }, cues: [cue('reveal', 'second', 'start', { type: 'visibility', targetId: 'arrow', visible: true }), cue('focus', 'first', .5, { type: 'highlight', targetId: 'equation', active: true }), cue('move', 'first', .5, { type: 'tween', targetId: 'equation', property: 'x', from: 10, to: 110, durationMs: 1000 }), cue('fade', 'first', .5, { type: 'tween', targetId: 'equation', property: 'opacity', from: 1, to: .2, durationMs: 1000 })] };
const cursor = (chunkId: string, progress: number) => ({ cursor: { beatId: 'beat', chunkId, offsetSeconds: progress * 2, passId: 'pass' } satisfies PlaybackCursor, offsetSeconds: progress * 2, durationSeconds: 2, progress });

describe('accepted narration visual timeline', () => {
  it('reveals at the associated chunk and highlights only after its cue', () => {
    expect(evaluateVisualFrame(beat, cursor('first', .2), entities).entities.map(e => e.id)).toEqual(['equation']);
    expect(evaluateVisualFrame(beat, cursor('first', .2), entities).highlightedIds).toEqual([]);
    expect(evaluateVisualFrame(beat, cursor('first', .75), entities).highlightedIds).toEqual(['equation']);
    expect(evaluateVisualFrame(beat, cursor('second', 0), entities).entities.map(e => e.id)).toEqual(['equation', 'arrow']);
  });
  it('interpolates equation position and opacity from audio time', () => {
    const frame = evaluateVisualFrame(beat, cursor('first', .75), entities);
    expect(frame.entities[0]).toMatchObject({ x: 60, opacity: .6 });
    expect(frame.appliedCueIds).toEqual(['focus', 'move', 'fade']);
  });
  it('replays deterministically without mutating accepted baseline or learner notes', () => {
    const notes: SceneEntity[] = [...entities, { id: 'note', kind: 'text', x: 5, y: 9, text: 'Keep me', semanticRole: 'learner-note' }];
    const before = JSON.stringify(notes);
    const a = evaluateVisualFrame(beat, cursor('first', .75), notes);
    evaluateVisualFrame(beat, cursor('second', 1), notes);
    expect(evaluateVisualFrame(beat, cursor('first', .75), notes)).toEqual(a);
    expect(a.entities.find(e => e.id === 'note')?.text).toBe('Keep me');
    expect(JSON.stringify(notes)).toBe(before);
  });
  it('uses stable endpoint poses for reduced motion while retaining cue timing', () => {
    const baseline = { entities, reducedMotion: true };
    expect(evaluateVisualFrame(beat, cursor('first', .49), baseline).entities[0].x).toBe(10);
    expect(evaluateVisualFrame(beat, cursor('first', .5), baseline).entities[0]).toMatchObject({ x: 110, opacity: .2 });
  });
  it('ignores invalid targets and invalid controls without acknowledging them', () => {
    const invalid = { ...beat, cues: [cue('bad', 'first', 'start', { type: 'visibility', targetId: 'unknown', visible: false }), cue('bad-control', 'first', 'start', { type: 'experiment', controlId: 'unknown', value: 1 })] };
    const frame = evaluateVisualFrame(invalid, cursor('first', 1), entities);
    expect(frame.appliedCueIds).toEqual([]); expect(frame.invalidCueIds).toEqual(['bad', 'bad-control']);
    expect(frame.entities).toEqual(entities);
  });
  it('evaluates cameras and validated experiment inputs at their own cue time', () => {
    const withControls: TeachingBeat = { ...beat, simulation: { id: 'sim', title: 'Motion', source: 'trusted boundary', assumptions: [], validation: 'illustrative', controls: [{ id: 'speed', label: 'Speed', type: 'slider', value: 1, min: 0, max: 10 }] }, cues: [cue('camera', 'first', 'start', { type: 'camera', x: 100, y: 50, zoom: 2, durationMs: 2000 }), cue('speed', 'first', .5, { type: 'experiment', controlId: 'speed', value: 4 })] };
    const frame = evaluateVisualFrame(withControls, cursor('first', .5), { entities, camera: { x: 0, y: 0, zoom: 1 } });
    expect(frame.camera).toEqual({ x: 50, y: 25, zoom: 1.5 });
    expect(frame.experimentValues).toEqual({ speed: 4 }); expect(frame.experimentCues).toEqual([{ id: 'speed', controlId: 'speed', value: 4 }]); expect(frame.simulationTargetTick).toBe(60);
  });
  it('keeps legacy boards intact without inventing reveal cues', () => {
    const legacy = { ...beat, chunks: undefined, cues: undefined };
    const frame = evaluateVisualFrame(legacy, { beatId: 'beat', chunkId: 'beat:chunk:1', offsetSeconds: 0, passId: 'pass' }, entities);
    expect(frame.entities).toEqual(entities); expect(frame.appliedCueIds).toEqual([]);
  });
});

it('rejects tweens that would invalidate a saved scene or unsupported spatial properties', () => {
  const spatialBeat: TeachingBeat = { ...beat, spatialScene: { nodes: [{ id: 'ball', kind: 'sphere', position: [0,0,0], material: 'blue' }], camera: { position: [3,3,5], target: [0,0,0] }, fallbackDescription: 'A sphere.' }, cues: [cue('font', 'first', 'start', { type: 'tween', targetId: 'equation', property: 'fontSize', from: 24, to: 900, durationMs: 10 }), cue('unsupported', 'first', 'start', { type: 'tween', targetId: 'ball', property: 'strokeWidth', from: 1, to: 3, durationMs: 10 })] };
  const result = evaluateVisualFrame(spatialBeat, cursor('first', 1), entities);
  expect(result.invalidCueIds).toEqual(['font','unsupported']); expect(result.appliedCueIds).toEqual([]);
});

it('fits future hidden entities and motion endpoints without revealing them', () => {
  const accepted: TeachingBeat = { ...beat, cues: [cue('later', 'second', 'start', { type: 'visibility', targetId: 'equation', visible: true }), cue('motion', 'second', 'start', { type: 'tween', targetId: 'equation', property: 'x', from: 10, to: 850, durationMs: 1000 })] };
  const first = evaluateVisualFrame(accepted, cursor('first', 0), entities);
  expect(first.entities.some(entity => entity.id === 'equation')).toBe(false);
  expect(first.fitEntities?.some(entity => entity.id === 'equation' && entity.x === 850)).toBe(true);
  expect(first.appliedCueIds).toEqual([]);
});

it('applies spatial dimensions and retained chunk durations to the same deterministic frame', () => {
  const spatialBeat: TeachingBeat = { ...beat, spatialScene: { nodes: [{ id: 'ball', kind: 'sphere', position: [0,0,0], material: 'blue' }], camera: { position: [3,3,5], target: [0,0,0] }, fallbackDescription: 'A sphere.' }, cues: [cue('radius', 'second', 'start', { type: 'tween', targetId: 'ball', property: 'radius', from: 1, to: 2, durationMs: 1000 })] };
  const result = evaluateVisualFrame(spatialBeat, cursor('second', .25), { entities, chunkDurations: { first: 5 } });
  expect(result.spatialScene?.nodes[0].scale).toEqual([3,3,3]); expect(result.simulationTargetTick).toBe(330);
});

describe('meaningful path motion', () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 90 }];
  const moving: TeachingBeat = { ...beat, cues: [cue('journey', 'first', 'start', { type: 'path', targetId: 'arrow', points, durationMs: 1000 })] };
  it('moves at a constant distance rate along unequal segments using only the audio position', () => {
    const midpoint = evaluateVisualFrame(moving, cursor('first', .25), entities);
    expect(midpoint.entities.find(entity => entity.id === 'arrow')).toMatchObject({ x: 10, y: 40 });
    expect(midpoint.appliedCueIds).toEqual(['journey']); expect(midpoint.completedCueIds).toEqual([]);
    const completed = evaluateVisualFrame(moving, cursor('first', .5), entities);
    expect(completed.entities.find(entity => entity.id === 'arrow')).toMatchObject({ x: 10, y: 90 });
    expect(completed.completedCueIds).toEqual(['journey']);
  });
  it('holds the first path pose before a future start and fits every point without acknowledging the motion', () => {
    const future: TeachingBeat = { ...moving, cues: [{ ...moving.cues![0], chunkId: 'second' }] };
    const before = evaluateVisualFrame(future, cursor('first', 0), entities);
    expect(before.entities.find(entity => entity.id === 'arrow')).toMatchObject(points[0]);
    for (const point of points) expect(before.fitEntities).toContainEqual(expect.objectContaining({ id: 'arrow', ...point }));
    expect(before.appliedCueIds).toEqual([]);
  });
  it('freezes at an unchanged audio position and reproduces the same pose after resume or replay', () => {
    const original = JSON.stringify(entities), paused = evaluateVisualFrame(moving, cursor('first', .15), entities);
    expect(evaluateVisualFrame(moving, cursor('first', .15), entities)).toEqual(paused);
    evaluateVisualFrame(moving, cursor('second', 1), entities);
    expect(evaluateVisualFrame(moving, cursor('first', .15), entities)).toEqual(paused);
    expect(evaluateVisualFrame(moving, cursor('first', .25), entities).entities).not.toEqual(paused.entities);
    expect(JSON.stringify(entities)).toBe(original);
  });
  it('uses the final path pose for reduced motion only when the cue starts', () => {
    const delayed: TeachingBeat = { ...moving, cues: [{ ...moving.cues![0], at: .5 }] };
    const baseline = { entities, reducedMotion: true };
    expect(evaluateVisualFrame(delayed, cursor('first', .49), baseline).entities.find(entity => entity.id === 'arrow')).toMatchObject(points[0]);
    const frame = evaluateVisualFrame(delayed, cursor('first', .5), baseline);
    expect(frame.entities.find(entity => entity.id === 'arrow')).toMatchObject(points[2]); expect(frame.completedCueIds).toEqual(['journey']);
  });
  it('handles repeated points and a zero-length path without non-finite coordinates', () => {
    const stationary: TeachingBeat = { ...moving, cues: [cue('still', 'first', 'start', { type: 'path', targetId: 'arrow', points: [{ x: 4, y: 8 }, { x: 4, y: 8 }], durationMs: 1000 })] };
    expect(evaluateVisualFrame(stationary, cursor('first', .25), entities).entities.find(entity => entity.id === 'arrow')).toMatchObject({ x: 4, y: 8 });
  });
  it('rejects malformed paths, spatial targets and learner annotations without moving or acknowledging them', () => {
    const notes: SceneEntity[] = [...entities, { id: 'note', kind: 'text', x: 3, y: 6, text: 'Mine', semanticRole: 'learner-note' }];
    const invalid: TeachingBeat = { ...moving, spatialScene: { nodes: [{ id: 'ball', kind: 'sphere', position: [0, 0, 0], material: 'blue' }], camera: { position: [3, 3, 5], target: [0, 0, 0] }, fallbackDescription: 'A sphere.' }, cues: [cue('short', 'first', 'start', { type: 'path', targetId: 'arrow', points: [{ x: 0, y: 0 }], durationMs: 1000 }), cue('spatial', 'first', 'start', { type: 'path', targetId: 'ball', points, durationMs: 1000 }), cue('annotation', 'first', 'start', { type: 'path', targetId: 'note', points, durationMs: 1000 })] };
    const frame = evaluateVisualFrame(invalid, cursor('first', .25), notes);
    expect(frame.invalidCueIds).toEqual(['short', 'spatial', 'annotation']); expect(frame.appliedCueIds).toEqual([]); expect(frame.entities).toEqual(notes);
  });
});
