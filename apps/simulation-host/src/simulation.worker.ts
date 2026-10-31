import variant from '@jitl/quickjs-wasmfile-release-sync'
import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url&inline'
import { newQuickJSWASMModule, newVariant } from 'quickjs-emscripten'
import { SimulationRuntime } from '@living-canvas/simulation'
import { ModelSimulationRuntime } from '../../../packages/simulation/src/model-runtime'
import type { SimulationInput } from '@living-canvas/protocol'

// WASM is bundled into this trusted worker. Generated JavaScript is only ever
// evaluated by QuickJS, which receives no bridges into this worker's globals.
async function boot() {
  const bytes = Uint8Array.from(atob(wasmUrl.split(',')[1]), character => character.charCodeAt(0)).buffer
  const module = await newQuickJSWASMModule(newVariant(variant, { wasmBinary: bytes }))
  const runtime = new ModelSimulationRuntime(await SimulationRuntime.create(module))
  self.onmessage = ({ data }: MessageEvent<{ type: string; id: string; input: SimulationInput }>) => {
    if (data.type !== 'run') return
    const input = data.input
    try {
      const result = runtime.run(input)
      self.postMessage({ type: 'result', id: data.id, result })
    } catch (error) { self.postMessage({ type: 'result', id: data.id, result: { state: null, entities: [], error: error instanceof Error ? error.message : 'The experiment could not run' } }) }
  }
  self.postMessage({ type: 'ready' })
}
void boot().catch(() => self.postMessage({ type: 'boot-error' }))
