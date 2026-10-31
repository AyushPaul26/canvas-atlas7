import { getQuickJS, type QuickJSContext, type QuickJSRuntime, type QuickJSWASMModule } from 'quickjs-emscripten'
import { LIMITS, assertBoundedJson, parseScene, type SceneEntity, type SimulationResult } from '../../protocol/src/index.ts'

interface GuestRun { runtime: QuickJSRuntime; context: QuickJSContext; tick: number; source: string; last?: SimulationResult }
const finiteRecord = (input: unknown): Record<string, number | string> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const result: Record<string, number | string> = Object.create(null)
  for (const [key, value] of Object.entries(input)) {
    if (key.length > 100 || !((typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 500)))
      throw new Error('Simulation measurements must be finite numbers or short strings')
    result[key] = value
  }
  return result
}
export class SimulationRuntime {
  private runs = new Map<string, GuestRun>()
  private module: QuickJSWASMModule
  private constructor(module: QuickJSWASMModule) { this.module = module }
  static async create(module?: QuickJSWASMModule): Promise<SimulationRuntime> { return new SimulationRuntime(module ?? await getQuickJS()) }
  /** Share compiled WASM while keeping staged programs in separate runtimes. */
  fork(): SimulationRuntime { return new SimulationRuntime(this.module) }
  private evaluate(run: GuestRun, code: string, budget: number = LIMITS.invocationMs): string {
    const deadline = performance.now() + budget
    run.runtime.setInterruptHandler(() => performance.now() > deadline)
    const result = run.context.evalCode(code)
    try {
      if (result.error) throw new Error('Simulation execution failed or exceeded its execution budget')
      const value = run.context.getString(result.value)
      if (value.length > LIMITS.sceneBytes) throw new Error('Simulation output exceeds the message size limit')
      return value
    } finally {
      if (result.error) result.error.dispose()
      else result.value.dispose()
    }
  }
  load(id: string, source: string, parameters: Record<string, unknown>, seed = 42): SimulationResult {
    if (new TextEncoder().encode(source).byteLength > LIMITS.sourceBytes) throw new Error('Simulation source is too large')
    const runtime = this.module.newRuntime()
    runtime.setMemoryLimit(LIMITS.guestHeap)
    runtime.setMaxStackSize(LIMITS.guestStack)
    const context = runtime.newContext()
    const run: GuestRun = { runtime, context, tick: 0, source }
    try {
      const bootstrap = '(function(){let seed=' + (Math.trunc(seed) >>> 0) + ';' +
        'Math.random=function(){seed+=0x6D2B79F5;let t=seed;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296};' +
        'globalThis.Date=undefined;const stringify=JSON.stringify.bind(JSON),finite=Number.isFinite;' +
        'const serialize=function(value){const text=stringify(value,function(k,v){if(typeof v==="number"&&!finite(v))throw Error("Nonfinite number");return v});' +
        'if(typeof text!=="string"||text.length>' + LIMITS.sceneBytes + ')throw Error("Output limit");return text};' +
        'Object.defineProperty(globalThis,"__lcSerialize",{value:serialize,writable:false,configurable:false})})();'
      this.evaluate(run, bootstrap + '\n' + source + '\n"loaded"', LIMITS.initMs)
      const params = JSON.stringify(parameters)
      assertBoundedJson(params)
      const result = this.read(run, 'globalThis.__lcState=globalThis.simulation.init(' + params + ',' + Math.trunc(seed) + ');', LIMITS.initMs)
      // A bad proposal must never evict the learner's last working model.
      this.adopt(id, run)
      return result
    } catch (error) { context.dispose(); runtime.dispose(); throw error }
  }
  private read(run: GuestRun, operation: string, budget: number = LIMITS.invocationMs): SimulationResult {
    const result = this.evaluate(run, operation + '\n__lcSerialize({state:globalThis.__lcState,frame:globalThis.simulation.render(globalThis.__lcState,' + run.tick + ')})', budget)
    run.last = this.decode(result)
    return structuredClone(run.last)
  }
  private decode(result: string): SimulationResult {
    const parsed = assertBoundedJson(result) as { state: unknown; frame: unknown }
    const frame = parsed.frame as { entities?: unknown; measurements?: unknown } | null
    if (!frame || !Array.isArray(frame.entities)) throw new Error('Simulation render must return an entities array')
    const entities: SceneEntity[] = parseScene(frame.entities)
    if (new TextEncoder().encode(JSON.stringify(frame)).byteLength > LIMITS.frameBytes) throw new Error('Simulation frame is too large')
    return { state: parsed.state, entities, measurements: finiteRecord(frame.measurements) }
  }
  private run(id: string): GuestRun {
    const run = this.runs.get(id)
    if (!run) throw new Error('This experiment is no longer running; reset it to continue')
    return run
  }
  private adopt(id: string, run: GuestRun): void {
    this.cancel(id)
    if (this.runs.size >= 2) this.cancel(this.runs.keys().next().value!)
    this.runs.set(id, run)
  }
  step(id: string, ticks = 1, dt = LIMITS.fixedDt): SimulationResult {
    const run = this.run(id)
    const count = Math.max(1, Math.min(4, Math.trunc(ticks)))
    if (!Number.isFinite(dt) || dt <= 0 || dt > 1) throw new Error('Invalid simulation time step')
    try {
      let result: SimulationResult | undefined
      for (let i = 0; i < count; i++) {
        run.tick++
        result = this.read(run, 'globalThis.__lcState=globalThis.simulation.step(globalThis.__lcState,' + run.tick + ',' + dt + ');')
      }
      return result!
    } catch (error) { this.cancel(id); throw error }
  }
  input(id: string, values: Record<string, unknown>): SimulationResult {
    const run = this.run(id)
    const json = JSON.stringify(values)
    assertBoundedJson(json, 32 * 1024)
    try { return this.read(run, 'globalThis.__lcState=globalThis.simulation.input(globalThis.__lcState,' + json + ',' + run.tick + ');') }
    catch (error) { this.cancel(id); throw error }
  }
  replay(id: string, source: string, initialValues: Record<string, unknown>, checkpoint: { tick: number; inputs: Array<{ tick: number; values: Record<string, unknown> }> }): SimulationResult {
    if (!Number.isInteger(checkpoint.tick) || checkpoint.tick < 0 || checkpoint.tick > 36_000 || checkpoint.inputs.length > 1000)
      throw new Error('This saved experiment is too long to replay; reset it to continue')
    let previousTick = 0
    for (const input of checkpoint.inputs) {
      if (!Number.isInteger(input.tick) || input.tick < previousTick || input.tick > checkpoint.tick) throw new Error('Invalid experiment input history')
      assertBoundedJson(JSON.stringify(input.values), 32 * 1024); previousTick = input.tick
    }
    const staging = new SimulationRuntime(this.module)
    const initial = staging.load(id, source, initialValues)
    const run = staging.run(id)
    if (!checkpoint.tick && !checkpoint.inputs.length) { staging.runs.delete(id); this.adopt(id, run); return initial }
    const log = JSON.stringify(checkpoint.inputs)
    // Replay the same init/step/input/render sequence, including closure and RNG
    // state. Replacing only the returned JSON state would silently lose both.
    const program = `(function(){const inputs=${log};let tick=0,text;function frame(){text=__lcSerialize({state:globalThis.__lcState,frame:globalThis.simulation.render(globalThis.__lcState,tick)})}for(const entry of inputs){while(tick<entry.tick){tick++;globalThis.__lcState=globalThis.simulation.step(globalThis.__lcState,tick,${LIMITS.fixedDt});frame()}globalThis.__lcState=globalThis.simulation.input(globalThis.__lcState,entry.values,tick);frame()}while(tick<${checkpoint.tick}){tick++;globalThis.__lcState=globalThis.simulation.step(globalThis.__lcState,tick,${LIMITS.fixedDt});frame()}return text})()`
    try { const result = this.evaluate(run, program, 1000); run.tick = checkpoint.tick; run.last = this.decode(result); staging.runs.delete(id); this.adopt(id, run); return structuredClone(run.last) }
    finally { staging.dispose() }
  }
  render(id: string): SimulationResult {
    const run = this.run(id)
    return structuredClone(run.last!)
  }
  preflight(source: string, parameters: Record<string, unknown>): SimulationResult {
    const temporary = new SimulationRuntime(this.module)
    try {
      const initial = temporary.load('preflight', source, parameters)
      temporary.step('preflight')
      temporary.input('preflight', parameters)
      return initial
    }
    finally { temporary.dispose() }
  }
  cancel(id: string): void {
    const run = this.runs.get(id)
    if (run) { this.runs.delete(id); run.context.dispose(); run.runtime.dispose() }
  }
  dispose(): void { for (const id of [...this.runs.keys()]) this.cancel(id) }
}

