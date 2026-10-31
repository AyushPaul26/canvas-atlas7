import { afterEach, describe, expect, it } from 'vitest'
import { SimulationRuntime } from '../../packages/simulation/src/index'

const source = `globalThis.simulation = {
  init(p) { return { x: p.start || 0 } },
  step(s, tick, dt) { return { x: s.x + dt * 3 } },
  input(s, values) { return { x: values.start } },
  render(s) { return { entities: [{id:'point',kind:'circle',x:s.x,y:10,radius:4}], measurements:{distance:s.x} } }
}`
const runtimes: SimulationRuntime[] = []
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()))
const create = async () => { const runtime = await SimulationRuntime.create(); runtimes.push(runtime); return runtime }

describe('generated computation boundary', () => {
  it('runs a newly supplied model and local controls without a registered topic', async () => {
    const runtime = await create()
    const initial = runtime.load('model', source, { start: 5 })
    expect(initial.entities[0].x).toBe(5)
    const next = runtime.step('model', 2, 1 / 60)
    expect(next.entities[0].x).toBeCloseTo(5.1)
    expect(runtime.input('model', { start: 12 }).entities[0].x).toBe(12)
  })
  it('does not expose the host process, filesystem or network', async () => {
    const runtime = await create()
    const result = runtime.load('probe', `globalThis.simulation={init(){return{}},step(s){return s},render(){return {entities:[{id:'check',kind:'text',x:0,y:0,text:[typeof process,typeof require,typeof fetch,typeof window].join(',')}]}}}`, {})
    expect(result.entities[0].text).toBe('undefined,undefined,undefined,undefined')
  })
  it('interrupts a runaway program and can run a new program afterwards', async () => {
    const runtime = await create()
    expect(() => runtime.load('loop', 'while(true){}', {})).toThrow(/budget|failed|interrupt/i)
    expect(runtime.load('good', source, { start: 2 }).entities[0].x).toBe(2)
  })
  it('bounds getters during serialization and rejects nonfinite drawings', async () => {
    const runtime = await create()
    const getter = `globalThis.simulation={init(){return{}},render(){return {get entities(){while(true){}}}}}`
    expect(() => runtime.load('getter', getter, {})).toThrow()
    expect(() => runtime.load('bad', `globalThis.simulation={init(){return{}},render(){return {entities:[{id:'n',kind:'circle',x:Infinity,y:0}]}}}`, {})).toThrow()
  })
  it('replays closures, seeded randomness, input changes and render side effects', async () => {
    const runtime = await create()
    const program = `let calls=0; globalThis.simulation={init(p){return{x:p.start+Math.random()}},step(s){return{x:s.x+1+Math.random()}},input(s,p){return{x:p.start}},render(s){calls++;return{entities:[{id:'point',kind:'text',x:s.x,y:0,text:String(calls)}]}}}`
    runtime.load('original', program, { start: 3 })
    runtime.step('original'); runtime.step('original')
    runtime.input('original', { start: 10 })
    runtime.step('original'); runtime.step('original'); const expected = runtime.step('original')
    const restored = runtime.replay('restored', program, { start: 3 }, { tick: 5, inputs: [{ tick: 2, values: { start: 10 } }] })
    expect(restored).toEqual(expected)
    expect(runtime.step('restored')).toEqual(runtime.step('original'))
    const afterInput = runtime.input('original', { start: 20 })
    expect(runtime.replay('restored', program, { start: 3 }, { tick: 6, inputs: [{ tick: 2, values: { start: 10 } }, { tick: 6, values: { start: 20 } }] })).toEqual(afterInput)
  })
  it('replays the exported API when a lexical simulation variable shadows it', async () => {
    const runtime = await create()
    const program = `const simulation = {}; ${source}`
    runtime.load('original', program, { start: 3 })
    runtime.step('original', 2)
    runtime.input('original', { start: 10 })
    const expected = runtime.step('original')
    expect(runtime.replay('restored', program, { start: 3 }, { tick: 3, inputs: [{ tick: 2, values: { start: 10 } }] })).toEqual(expected)
    expect(runtime.step('restored')).toEqual(runtime.step('original'))
  })
  it('preserves observable serialization during replay and treats render as a frame query', async () => {
    const runtime = await create()
    const getterProgram = `let reads=0;globalThis.simulation={init(){return{get x(){return ++reads}}},step(s){return s},render(){return{entities:[{id:'read',kind:'text',x:0,y:0,text:String(reads)}]}}}`
    runtime.load('original', getterProgram, {})
    runtime.step('original'); const frame = runtime.step('original')
    expect(runtime.render('original')).toEqual(frame)
    expect(runtime.replay('restored', getterProgram, {}, { tick: 2, inputs: [] })).toEqual(frame)
  })
  it.each([
    ['missing step', `input(s){return s}`],
    ['missing input', `step(s){return s}`],
    ['throwing step', `step(){throw Error('bad step')},input(s){return s}`],
    ['throwing input', `step(s){return s},input(){throw Error('bad input')}`],
    ['runaway step', `step(){while(true){}},input(s){return s}`],
    ['runaway input', `step(s){return s},input(){while(true){}}`],
  ])('rejects %s during disposable preflight', async (_name, methods) => {
    const runtime = await create()
    const program = `globalThis.simulation={init(){return{x:0}},${methods},render(s){return{entities:[{id:'point',kind:'circle',x:s.x,y:0,radius:4}]}}}`
    expect(() => runtime.preflight(program, { start: 3 })).toThrow()
  })
  it('exercises one fixed step and default input while retaining the initialization preview', async () => {
    const runtime = await create()
    runtime.load('visible', source, { start: 4 })
    runtime.load('another', source, { start: 8 })
    const program = `let renders=0;globalThis.simulation={
      init(p){return{x:p.start}},
      step(s,tick,dt){if(tick!==1||dt!==1/60)throw Error('unexpected step');return{x:s.x+100}},
      input(s,p,tick){if(s.x!==103||p.start!==3||tick!==1)throw Error('unexpected input');return{x:200}},
      render(s){return{entities:[{id:'point',kind:'circle',x:s.x,y:0,radius:4}],measurements:{renders:++renders}}}
    }`
    const preview = runtime.preflight(program, { start: 3 })
    expect(preview.state).toEqual({ x: 3 })
    expect(preview.entities[0].x).toBe(3)
    expect(preview.measurements).toEqual({ renders: 1 })
    expect(runtime.step('visible').entities[0].x).toBeCloseTo(4.05)
    expect(runtime.step('another').entities[0].x).toBeCloseTo(8.05)
  })
  it('keeps live experiments when a replacement or an ephemeral preflight fails', async () => {
    const runtime = await create()
    runtime.load('visible', source, { start: 4 }); runtime.load('another', source, { start: 8 })
    expect(() => runtime.load('bad', 'while(true){}', {})).toThrow()
    expect(runtime.step('visible').entities[0].x).toBeCloseTo(4.05)
    expect(() => runtime.preflight('while(true){}', {})).toThrow()
    expect(runtime.preflight(source, { start: 2 }).entities[0].x).toBe(2)
    expect(runtime.step('another').entities[0].x).toBeCloseTo(8.05)
    const badReplay = `globalThis.simulation={init(){return{}},step(){while(true){}},render(){return{entities:[]}}}`
    expect(() => runtime.replay('replacement', badReplay, {}, { tick: 1, inputs: [] })).toThrow()
    expect(runtime.step('visible').entities[0].x).toBeCloseTo(4.1)
  })
})
