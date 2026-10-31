import { afterEach, describe, expect, it } from 'vitest';
import { parseTeachingBeat, simulationArtifactSchema, type SceneEntity, type SimulationArtifact, type TeachingBeat, type VisualCue } from '../../packages/protocol/src/index';
import { evaluateVisualFrame } from '../../packages/scene/src/timeline';
import { SimulationRuntime } from '../../packages/simulation/src/index';

// Deliberately authored test fixtures: these verify the rendering/computation
// contracts across subjects, not the quality of live model-generated lessons.
const runtimes: SimulationRuntime[] = [];
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()));
async function runtime() { const value = await SimulationRuntime.create(); runtimes.push(value); return value; }
const artifact = (id: string, source: string, assumptions: string[], controls: SimulationArtifact['controls'] = []) => simulationArtifactSchema.parse({ id, title: id, source, assumptions, controls, validation: 'illustrative' });
const cue = (id: string, chunkId: string, at: VisualCue['at'], action: VisualCue['action']): VisualCue => ({ id, chunkId, at, action });
function lesson(id: string, texts: string[], entities: SceneEntity[], cues: VisualCue[], simulation?: SimulationArtifact): TeachingBeat {
  const chunks = texts.map((text, index) => ({ id: `${id}:${index}`, text }));
  return parseTeachingBeat({ id, narration: texts.join(''), chunks, cues, canvas: { mode: 'replace', entities }, simulation, next: 'finish' });
}
function frame(beat: TeachingBeat, chunk: number, progress: number) {
  return evaluateVisualFrame(beat, { cursor: { beatId: beat.id, chunkId: beat.chunks![chunk].id, offsetSeconds: progress * 2, passId: 'test-pass' }, durationSeconds: 2, offsetSeconds: progress * 2, progress }, { entities: beat.canvas.entities, chunkDurations: Object.fromEntries(beat.chunks!.map(value => [value.id, 2])) });
}

const gravity = artifact('inverse-square', `globalThis.simulation={
  init(p){return {m1:p.m1,m2:p.m2,r:p.r}},step(s){return s},
  input(s,p){return Object.assign({},s,p)},
  render(s){if(s.r<=0)throw Error('Distance must be positive');return {entities:[
    {id:'force',kind:'equation',x:40,y:40,text:'F=Gm_1m_2/r^2'}
  ],measurements:{forceNewtons:6.67430e-11*s.m1*s.m2/(s.r*s.r)}}}
}`, ['Newtonian gravity between point masses or non-overlapping spherical masses.', 'SI units: kilograms, metres and newtons; r is centre-to-centre distance.'], [
  { id: 'm1', label: 'First mass', type: 'slider', value: 5, min: 1, max: 20, unit: 'kg' },
  { id: 'm2', label: 'Second mass', type: 'slider', value: 7, min: 1, max: 20, unit: 'kg' },
  { id: 'r', label: 'Centre distance', type: 'slider', value: 3, min: 1, max: 12, unit: 'm' },
]);

describe('test-only subject fixtures through the accepted teaching contracts', () => {
  it('computes inverse-square force in QuickJS and responds correctly to independent local controls', async () => {
    const guest = await runtime();
    const force = (values: Record<string, number>) => Number(guest.input('gravity', values).measurements!.forceNewtons);
    const initial = Number(guest.load('gravity', gravity.source, { m1: 5, m2: 7, r: 3 }).measurements!.forceNewtons);
    expect(initial).toBeCloseTo(2.595561111111111e-10, 20);
    expect(force({ r: 6 }) / initial).toBeCloseTo(.25, 12);
    expect(force({ r: 3, m1: 10 }) / initial).toBeCloseTo(2, 12);
    expect(force({ m1: 5, m2: 14 }) / initial).toBeCloseTo(2, 12);
    expect(force({ m1: 10, m2: 14, r: 6 }) / initial).toBeCloseTo(1, 12);
  });

  it('pairs a distance cue with the same sandbox control change, retaining the original board for replay', async () => {
    const beat = lesson('gravity', ['Start with the two masses. ', 'Now double their separation. '], [
      { id: 'mass-a', kind: 'circle', x: 100, y: 200, radius: 30 },
      { id: 'mass-b', kind: 'circle', x: 300, y: 200, radius: 30 },
      { id: 'law', kind: 'equation', x: 100, y: 320, text: 'F=Gm_1m_2/r^2' },
    ], [cue('show-law', 'gravity:0', .5, { type: 'visibility', targetId: 'law', visible: true }), cue('double-r', 'gravity:1', 'start', { type: 'experiment', controlId: 'r', value: 6 }), cue('separate', 'gravity:1', 'start', { type: 'tween', targetId: 'mass-b', property: 'x', from: 300, to: 500, durationMs: 1000 })], gravity);
    const guest = await runtime(); const initial = Number(guest.load('gravity', gravity.source, { m1: 5, m2: 7, r: 3 }).measurements!.forceNewtons);
    expect(frame(beat, 0, .25).entities.map(entity => entity.id)).not.toContain('law');
    expect(frame(beat, 0, .75).experimentValues).toEqual({});
    const halfway = frame(beat, 1, .25), end = frame(beat, 1, 1);
    expect(halfway.entities.find(entity => entity.id === 'mass-b')?.x).toBe(400);
    expect(halfway.completedCueIds).not.toContain('separate');
    expect(Number(guest.input('gravity', halfway.experimentValues).measurements!.forceNewtons) / initial).toBeCloseTo(.25, 12);
    expect(end.entities.find(entity => entity.id === 'mass-b')?.x).toBe(500);
    expect(end.completedCueIds).toEqual(['show-law', 'double-r', 'separate']);
    expect(frame(beat, 1, .25)).toEqual(halfway);
    expect(beat.canvas.entities.find(entity => entity.id === 'mass-b')?.x).toBe(300);
  });

  it('keeps an analytic circular orbit within its declared approximation and units', async () => {
    const orbit = artifact('circular-orbit', `globalThis.simulation={
      init(p){return{mu:p.mu,r:p.r,t:0}},step(s,tick,dt){s.t+=dt;return s},input(s,p){return Object.assign({},s,p)},
      render(s){const omega=Math.sqrt(s.mu/(s.r*s.r*s.r)),angle=omega*s.t;return{entities:[
        {id:'planet',kind:'circle',x:200+100*Math.cos(angle),y:200+100*Math.sin(angle),radius:8}
      ],measurements:{speedKmPerSecond:Math.sqrt(s.mu/s.r),periodSeconds:2*Math.PI/omega,radiusKm:s.r,specificEnergyKm2PerS2:-s.mu/(2*s.r)}}}
    }`, ['Analytic circular Newtonian two-body orbit with a fixed central body.', 'mu is in km^3/s^2; radius is in km; elapsed time is in seconds.', 'Neglect atmosphere, oblateness and other bodies; drawing radius is scaled to 100 pixels.']);
    const guest = await runtime(); const initial = guest.load('orbit', orbit.source, { mu: 398600.4418, r: 7000 });
    expect(orbit.assumptions.join(' ')).toContain('Analytic circular');
    expect(orbit.assumptions.join(' ')).toContain('Neglect atmosphere');
    expect(initial.measurements!.speedKmPerSecond).toBeCloseTo(7.546053290107541, 10);
    expect(initial.measurements!.periodSeconds).toBeCloseTo(5828.516637686015, 6);
    for (let batch = 0; batch < 15; batch++) {
      const result = guest.step('orbit', 4, 1), planet = result.entities[0];
      expect(Math.hypot(planet.x - 200, planet.y - 200)).toBeCloseTo(100, 10);
      expect(result.measurements!.specificEnergyKm2PerS2).toBe(initial.measurements!.specificEnergyKm2PerS2);
    }
    const doubled = guest.input('orbit', { r: 14000 });
    expect(Number(doubled.measurements!.periodSeconds) / Number(initial.measurements!.periodSeconds)).toBeCloseTo(Math.sqrt(8), 12);
  });

  it('builds a right-triangle construction in stages and computes its areas after a control change', async () => {
    const triangle = artifact('pythagoras', `globalThis.simulation={
      init(p){return p},step(s){return s},input(s,p){return Object.assign({},s,p)},
      render(s){return{entities:[{id:'triangle',kind:'path',x:40,y:40,points:[0,0,20*s.a,0,0,20*s.b,0,0]}],measurements:{areaA:s.a*s.a,areaB:s.b*s.b,areaC:s.a*s.a+s.b*s.b,hypotenuse:Math.hypot(s.a,s.b)}}}
    }`, ['Euclidean right triangle; the two controlled sides are perpendicular.'], [{ id: 'a', label: 'Horizontal leg', type: 'slider', value: 3, min: 1, max: 20 }, { id: 'b', label: 'Vertical leg', type: 'slider', value: 4, min: 1, max: 20 }]);
    const guest = await runtime(); const result = guest.load('triangle', triangle.source, { a: 3, b: 4 });
    expect(result.measurements).toEqual({ areaA: 9, areaB: 16, areaC: 25, hypotenuse: 5 });
    expect(result.entities[0].points).toEqual([0, 0, 60, 0, 0, 80, 0, 0]);
    expect(guest.input('triangle', { a: 5, b: 12 }).measurements).toEqual({ areaA: 25, areaB: 144, areaC: 169, hypotenuse: 13 });
    const beat = lesson('construction', ['Construct the right triangle. ', 'Add a square on each leg. ', 'Compare the combined area with the hypotenuse square.'], [
      ...result.entities, { id: 'square-a', kind: 'rect', x: 40, y: 100, width: 60, height: 60 }, { id: 'square-b', kind: 'rect', x: 100, y: 40, width: 80, height: 80 }, { id: 'identity', kind: 'equation', x: 40, y: 240, text: '3^2+4^2=5^2' },
    ], [cue('a', 'construction:1', 'start', { type: 'visibility', targetId: 'square-a', visible: true }), cue('b', 'construction:1', .5, { type: 'visibility', targetId: 'square-b', visible: true }), cue('identity', 'construction:2', 'start', { type: 'visibility', targetId: 'identity', visible: true })], triangle);
    expect(frame(beat, 0, 1).entities.map(entity => entity.id)).toEqual(['triangle']);
    expect(frame(beat, 1, .25).entities.map(entity => entity.id)).toEqual(['triangle', 'square-a']);
    expect(frame(beat, 2, 0).entities.map(entity => entity.id)).toEqual(['triangle', 'square-a', 'square-b', 'identity']);
    expect(frame(beat, 2, 0).invalidCueIds).toEqual([]);
  });

  it('shows enzyme binding and release while conserving substrate units and regenerating the enzyme', async () => {
    const enzyme = artifact('enzyme-cycle', `globalThis.simulation={
      init(){return{E:1,S:3,ES:0,P:0}},input(s){return s},
      step(s){if(s.ES){s.ES--;s.E++;s.P++}else if(s.E&&s.S){s.E--;s.S--;s.ES++}return s},
      render(s){return{entities:[{id:'counts',kind:'text',x:20,y:20,text:'E '+s.E+' S '+s.S+' ES '+s.ES+' P '+s.P}],measurements:{freeEnzyme:s.E,complex:s.ES,substrate:s.S,product:s.P,enzymeUnits:s.E+s.ES,substrateUnits:s.S+s.ES+s.P}}}
    }`, ['Illustrative discrete E + S -> ES -> E + P cycle; steps are process stages, not measured reaction rates.', 'One substrate unit produces one product unit, and the enzyme is regenerated.']);
    const guest = await runtime(); guest.load('enzyme', enzyme.source, {});
    for (let tick = 1; tick <= 6; tick++) {
      const observed = guest.step('enzyme').measurements!;
      expect(observed.enzymeUnits).toBe(1); expect(observed.substrateUnits).toBe(3);
      expect(observed.complex).toBe(tick % 2);
    }
    expect(guest.render('enzyme').measurements).toMatchObject({ freeEnzyme: 1, complex: 0, substrate: 0, product: 3 });
    const beat = lesson('enzyme', ['The substrate approaches the active site. ', 'It binds to form a complex. ', 'Product leaves and the enzyme can act again.'], [
      { id: 'enzyme', kind: 'circle', x: 300, y: 200, radius: 60 }, { id: 'site', kind: 'rect', x: 270, y: 150, width: 60, height: 30 }, { id: 'substrate', kind: 'circle', x: 100, y: 150, radius: 15 }, { id: 'product', kind: 'circle', x: 450, y: 150, radius: 15 },
    ], [cue('bind', 'enzyme:1', 'start', { type: 'tween', targetId: 'substrate', property: 'x', from: 100, to: 300, durationMs: 1000 }), cue('site', 'enzyme:1', 'start', { type: 'highlight', targetId: 'site', active: true }), cue('hide-substrate', 'enzyme:2', 'start', { type: 'visibility', targetId: 'substrate', visible: false }), cue('product', 'enzyme:2', 'start', { type: 'visibility', targetId: 'product', visible: true }), cue('free-site', 'enzyme:2', 'start', { type: 'highlight', targetId: 'site', active: false })], enzyme);
    expect(frame(beat, 0, 1).entities.map(entity => entity.id)).not.toContain('product');
    expect(frame(beat, 1, .25).entities.find(entity => entity.id === 'substrate')?.x).toBe(200);
    expect(frame(beat, 1, 1).highlightedIds).toEqual(['site']);
    expect(frame(beat, 2, 0).entities.map(entity => entity.id)).toEqual(['enzyme', 'site', 'product']);
    expect(frame(beat, 2, 0).highlightedIds).toEqual([]);
  });

  it('runs stable insertion sort one insertion per step and stages the comparison before moving its key', async () => {
    const sorting = artifact('insertion-sort', `globalThis.simulation={
      init(){return{items:[{id:'four',v:4},{id:'two-a',v:2},{id:'two-b',v:2},{id:'one',v:1}],sorted:1}},input(s){return s},
      step(s){if(s.sorted>=s.items.length)return s;const key=s.items[s.sorted];let j=s.sorted-1;while(j>=0&&s.items[j].v>key.v){s.items[j+1]=s.items[j];j--}s.items[j+1]=key;s.sorted++;return s},
      render(s){return{entities:s.items.map((item,index)=>({id:item.id,kind:'rect',x:20+index*80,y:200-item.v*20,width:50,height:item.v*20,label:String(item.v)})),measurements:{sortedPrefix:s.sorted,values:s.items.map(item=>item.v).join(','),identities:s.items.map(item=>item.id).join(',')}}}
    }`, ['Each animation step performs one complete insertion into the sorted prefix.', 'Strict greater-than comparisons preserve the input order of equal keys.']);
    const guest = await runtime(); const initial = guest.load('sort', sorting.source, {});
    const expected = ['2,4,2,1', '2,2,4,1', '1,2,2,4'];
    for (const [index, values] of expected.entries()) {
      const observed = guest.step('sort').measurements!;
      expect(observed.values).toBe(values); expect(observed.sortedPrefix).toBe(index + 2);
      const prefix = String(observed.values).split(',').map(Number).slice(0, Number(observed.sortedPrefix));
      expect(prefix).toEqual([...prefix].sort((a, b) => a - b));
    }
    expect(guest.render('sort').measurements!.identities).toBe('one,two-a,two-b,four');
    const beat = lesson('insertion', ['Compare the key with the sorted prefix. ', 'Shift the larger value and insert the key.'], initial.entities, [
      cue('key', 'insertion:0', 'start', { type: 'highlight', targetId: 'two-a', active: true }), cue('compare', 'insertion:0', .5, { type: 'highlight', targetId: 'four', active: true }), cue('shift', 'insertion:1', 'start', { type: 'tween', targetId: 'four', property: 'x', from: 20, to: 100, durationMs: 1000 }), cue('insert', 'insertion:1', 'start', { type: 'tween', targetId: 'two-a', property: 'x', from: 100, to: 20, durationMs: 1000 }),
    ], sorting);
    expect(frame(beat, 0, .25).highlightedIds).toEqual(['two-a']);
    expect(frame(beat, 0, .75).highlightedIds).toEqual(['two-a', 'four']);
    const end = frame(beat, 1, 1);
    expect(end.entities.find(entity => entity.id === 'four')?.x).toBe(100);
    expect(end.entities.find(entity => entity.id === 'two-a')?.x).toBe(20);
    expect(end.completedCueIds).toEqual(['key', 'compare', 'shift', 'insert']);
    expect(frame(beat, 0, .25).entities).toEqual(initial.entities);
  });
});
