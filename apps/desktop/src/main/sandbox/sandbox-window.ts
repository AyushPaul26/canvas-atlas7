import { BrowserWindow, MessageChannelMain, session, type MessagePortMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIMITS, assertBoundedJson, parseScene, type SimulationArtifact,type SimulationInput, type SimulationResult } from '@living-canvas/protocol'
import {assertLearnerSafe,LearnerSafetyError} from '../../../../../packages/teacher/src/learner-safety'
import type {SafetyGate} from '../safety/contracts'

interface Options { rendererUrl?: string; rendererFile: string; preloadPath: string;safety?:SafetyGate }
interface Pending { resolve: (value: SimulationResult) => void; timer: ReturnType<typeof setTimeout>;runId:string;artifact:SimulationArtifact;action:SimulationInput['action'] }
const errorResult = (message: string): SimulationResult => ({ state: null, entities: [], error: message })

/** The generated program never enters Electron or a Chromium JS realm. The hidden
 * renderer is a second boundary around a terminable worker and its QuickJS VM. */
export function createSimulationService(options: Options) {
  let host: BrowserWindow | undefined
  let port: MessagePortMain | undefined
  let starting: Promise<void> | undefined
  let rejectStarting: ((reason: Error) => void) | undefined
  let bootTimer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let disposed = false
  const pending = new Map<string, Pending>()
  const admitted=new Map<string,{identity:string;artifact:SimulationArtifact;frame?:SimulationResult}>()
  let safetyWork=new AbortController()
  let serial: Promise<unknown> = Promise.resolve()
  const reset = (reason: string) => {
    generation++
    safetyWork.abort();safetyWork=new AbortController();admitted.clear()
    if (bootTimer) { clearTimeout(bootTimer); bootTimer = undefined }
    rejectStarting?.(new Error(reason)); rejectStarting = undefined
    for (const request of pending.values()) { clearTimeout(request.timer); request.resolve(errorResult(reason)) }
    pending.clear()
    port?.close(); port = undefined
    const previous = host; host = undefined; starting = undefined
    if (previous && !previous.isDestroyed()) previous.destroy()
  }
  const ensure = (): Promise<void> => {
    if (disposed) return Promise.reject(new Error('The experiment runner has closed'))
    if (starting) return starting
    const bootGeneration = generation
    starting = new Promise<void>((accept, reject) => {
      rejectStarting = reject
      const partition = session.fromPartition('simulation-' + randomUUID(), { cache: false })
      const root = resolve(dirname(options.rendererFile))
      partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      partition.setPermissionCheckHandler(() => false)
      partition.webRequest.onBeforeRequest((details, callback) => {
        let allowed = false
        try {
          const url = new URL(details.url)
          if (url.protocol === 'file:') { const path = resolve(fileURLToPath(url)); allowed = path.startsWith(root + sep) }
          else if (url.protocol === 'blob:' || url.protocol === 'data:') allowed = true
          else if (options.rendererUrl) allowed = url.origin === new URL(options.rendererUrl).origin && url.protocol === 'http:'
        } catch { /* Malformed and remote requests are denied. */ }
        callback({ cancel: !allowed })
      })
      partition.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'none'; style-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'"],
      } }))
      const window = new BrowserWindow({ show: false, width: 32, height: 32, webPreferences: {
        session: partition, preload: options.preloadPath, sandbox: true, contextIsolation: true,
        nodeIntegration: false, nodeIntegrationInWorker: false, webviewTag: false,
        webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false,
      } })
      host = window
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', event => event.preventDefault())
      window.webContents.on('will-redirect', event => event.preventDefault())
      window.webContents.on('will-attach-webview', event => event.preventDefault())
      const bootTimeout = setTimeout(() => { if (host === window) reset('The experiment runner did not start') }, LIMITS.workerReadyMs + 5000)
      bootTimer = bootTimeout
      window.webContents.once('did-finish-load', () => {
        if (host !== window || generation !== bootGeneration) return
        const channel = new MessageChannelMain(); port = channel.port1
        port.on('message', ({ data }) => {
          if (host !== window || generation !== bootGeneration) return
          if (data?.type === 'ready') { clearTimeout(bootTimeout); bootTimer = undefined; rejectStarting = undefined; accept(); return }
          if (data?.type === 'boot-error') { clearTimeout(bootTimeout); reject(new Error('The isolated experiment engine could not start')); reset('The isolated experiment engine could not start'); return }
          if (data?.type !== 'result' || typeof data.id !== 'string') return
          const request = pending.get(data.id)
          if (!request) return
          pending.delete(data.id); clearTimeout(request.timer)
          try {
            assertBoundedJson(JSON.stringify(data.result), LIMITS.sceneBytes)
            assertLearnerSafe(data.result,'simulation-frame')
            // An ordinary failed proposal never becomes a displayed frame and
            // must not evict or invalidate another accepted experiment.
            if(data.result.error){request.resolve(errorResult(String(data.result.error).slice(0,500)));return}
            const validated={...data.result,entities:parseScene(data.result.entities)}
            if(options.safety){
              const previous=request.action==='init'?undefined:admitted.get(request.runId)?.frame
              try{options.safety.derive(validated,[request.artifact,...(previous?[previous]:[])],'simulation-frame')}
              catch(error){const message=error instanceof Error?error.message:'This experiment needs a safety review.';request.resolve(errorResult(message));reset(message);return}
              if(request.action==='init'&&!request.runId.startsWith('preflight:')){
                admitted.delete(request.runId);if(admitted.size>=2)admitted.delete(admitted.keys().next().value!)
                admitted.set(request.runId,{identity:JSON.stringify(request.artifact),artifact:request.artifact,frame:structuredClone(validated)})
              }else{const run=admitted.get(request.runId);if(run)run.frame=structuredClone(validated)}
            }
            if (data.result.error) request.resolve(errorResult(String(data.result.error).slice(0, 500)))
            else request.resolve(validated)
          } catch (error) {
            if(error instanceof LearnerSafetyError){request.resolve(errorResult(error.message));reset(error.message)}
            else request.resolve(errorResult('The experiment returned an invalid frame'))
          }
        })
        port.start(); window.webContents.postMessage('sandbox:port', null, [channel.port2])
      })
      window.webContents.once('render-process-gone', () => { if (host === window) reset('The isolated experiment engine stopped; reset the experiment to continue') })
      const loading = options.rendererUrl ? window.loadURL(options.rendererUrl) : window.loadFile(options.rendererFile)
      void loading.catch(() => { if (host === window) reset('The experiment runner could not load') })
    })
    return starting
  }
  async function dispatch(input: SimulationInput, enqueuedGeneration: number): Promise<SimulationResult> {
    try {
      if (enqueuedGeneration !== generation || disposed) return errorResult('The experiment was stopped')
      assertBoundedJson(JSON.stringify(input), LIMITS.simulationRequestBytes, { maxNodes: LIMITS.simulationRequestNodes, maxDepth: LIMITS.envelopeDepth })
      assertLearnerSafe(input,'saved-content')
      if(options.safety){
        if(input.action==='init'){
          if(!options.safety.isApproved(input.artifact))await options.safety.inspect(input.artifact,'model-output',safetyWork.signal)
          options.safety.assertApproved(input.artifact,'saved-content')
        }else{
          const run=admitted.get(input.runId)
          if(!run||run.identity!==JSON.stringify(input.artifact))throw new Error('The experiment definition changed. Reset it to continue.')
          options.safety.assertApproved(input.artifact,'saved-content')
        }
      }
      if(enqueuedGeneration!==generation||disposed)return errorResult('The experiment was stopped')
      await ensure()
      if (enqueuedGeneration !== generation || disposed) return errorResult('The experiment was stopped')
      return await new Promise<SimulationResult>(accept => {
        const id = randomUUID()
        const timer = setTimeout(() => reset('The experiment exceeded its time limit; reset it to continue'), input.replay ? 2500 : LIMITS.watchdogMs + 1000)
        pending.set(id, { resolve: accept, timer,runId:input.runId,artifact:input.artifact,action:input.action })
        port!.postMessage({ type: 'run', id, input })
      })
    } catch (error) { return errorResult(error instanceof Error ? error.message : 'The experiment could not run') }
  }
  return {
    run(input: SimulationInput): Promise<SimulationResult> {
      const enqueuedGeneration = generation
      const result = serial.then(() => dispatch(input, enqueuedGeneration)); serial = result.catch(() => undefined); return result
    },
    cancelAll(): void { reset('The experiment was stopped') },
    dispose(): void { disposed = true; reset('The experiment runner has closed') },
  }
}
