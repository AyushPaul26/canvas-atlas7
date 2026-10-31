import { LIMITS, type SimulationInput } from '@living-canvas/protocol'

let port: MessagePort | undefined
let worker: Worker | undefined
let ready = false
let bootError = false
let active: { id: string; timer: ReturnType<typeof setTimeout> } | undefined
const fail = (message: string) => {
  if (active) { clearTimeout(active.timer); port?.postMessage({ type: 'result', id: active.id, result: { state: null, entities: [], error: message } }); active = undefined }
}
const start = () => {
  worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module', name: 'isolated-quickjs' })
  ready = false; bootError = false
  const timeout = setTimeout(() => { bootError = true; worker?.terminate(); port?.postMessage({ type: 'boot-error' }) }, LIMITS.workerReadyMs)
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') { clearTimeout(timeout); ready = true; port?.postMessage({ type: 'ready' }); return }
    if (data.type === 'boot-error') { clearTimeout(timeout); bootError = true; port?.postMessage({ type: 'boot-error' }); return }
    if (data.type === 'result' && active && active.id === data.id) {
      clearTimeout(active.timer); active = undefined; port?.postMessage(data)
    }
  }
  worker.onerror = () => { clearTimeout(timeout); bootError = true; fail('The experiment engine stopped; reset the experiment to continue'); port?.postMessage({ type: 'boot-error' }) }
}
window.addEventListener('message', event => {
  if (event.source !== window || event.data?.type !== 'living-canvas:sandbox-port' || event.ports.length !== 1 || port) return
  port = event.ports[0]
  port.onmessage = ({ data }: MessageEvent<{ type: string; id: string; input: SimulationInput }>) => {
    if (data.type !== 'run' || typeof data.id !== 'string') return
    if (!ready || !worker || active) { port?.postMessage({ type: 'result', id: data.id, result: { state: null, entities: [], error: 'The experiment engine is busy; reset the experiment to continue' } }); return }
    active = { id: data.id, timer: setTimeout(() => {
      fail('The experiment exceeded its time limit; reset it to continue')
      worker?.terminate(); start()
    }, data.input.replay ? 1500 : data.input.action === 'init' ? LIMITS.initMs + LIMITS.watchdogMs : LIMITS.watchdogMs) }
    worker.postMessage(data)
  }
  port.start()
  if (ready) port.postMessage({ type: 'ready' })
  else if (bootError) port.postMessage({ type: 'boot-error' })
})
start()
