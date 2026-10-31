import { test, expect, _electron as electron } from '@playwright/test'
import { join, resolve, sep } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import {installNativeSafety,nativeSafetyCounts} from '../fixtures/native-safety'

test('generated experiments execute in the desktop boundary and recover after runaway code', async () => {
  test.setTimeout(120000)
  const tempRoot = join(process.cwd(), '.test-tmp'); mkdirSync(tempRoot, { recursive: true })
  const directory = mkdtempSync(join(tempRoot, 'simulation-'))
  const executablePath = process.env.LIVING_CANVAS_PACKAGED_EXE
  const app = await electron.launch({ executablePath, args: executablePath ? [] : [join(process.cwd(), 'apps/desktop/out/main/app.js')], env: { ...process.env, LIVING_CANVAS_USER_DATA: directory } })
  const diagnostics: string[] = []
  app.on('window', window => { window.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()) }) })
  try {
    await installNativeSafety(app)
    const page = await app.firstWindow()
    await page.waitForFunction(() => !!(window as any).livingCanvas)
    await expect(page.getByRole('button', { name: 'Canvas Atlas home' })).toBeVisible()
    await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))))
    await page.screenshot({ path: join(tempRoot, 'desktop-home.png') })
    const results = await page.evaluate(async () => {
      const bridge = (window as any).livingCanvas
      const artifact = { id: 'trial', title: 'Generated test model', source: `const simulation={};globalThis.simulation={init(p){return{x:p.start}},step(s,t,dt){return{x:s.x+dt}},input(s,p){return{x:p.start}},render(s){return{entities:[{id:'dot',kind:'circle',x:s.x,y:10,radius:5}],measurements:{position:s.x}}}}`, controls: [{ id: 'start', label: 'Start', type: 'slider', value: 5, min: 0, max: 20 }], assumptions: ['Numerical test model'], validation: 'illustrative' }
      const initial = await bridge.runSimulation({ runId: 'trial', action: 'init', artifact, tick: 0, values: { start: 5 } })
      const stepped = await bridge.runSimulation({ runId: 'trial', action: 'step', artifact, tick: 0, dt: 1 / 60 })
      const probe = await bridge.runSimulation({ runId: 'probe', action: 'init', artifact: { ...artifact,assumptions:['Expected unavailable globals: undefined,undefined,undefined,undefined,undefined.'],source: `globalThis.simulation={init(){return{}},render(){return{entities:[{id:'p',kind:'text',x:0,y:0,text:[typeof process,typeof require,typeof fetch,typeof window,typeof importScripts].join(',')}]}}}` }, tick: 0 })
      const preflight = await bridge.runSimulation({ runId: 'preflight:extra', action: 'init', artifact, tick: 0 })
      const rejectedPreflight = await bridge.runSimulation({ runId: 'preflight:bad', action: 'init', artifact: { ...artifact, source: 'while(true){}' }, tick: 0 })
      const missingMethod = await bridge.runSimulation({ runId: 'preflight:missing', action: 'init', artifact: { ...artifact, source: 'globalThis.simulation={init(){return{}},render(){return{entities:[]}}}' }, tick: 0 })
      const stillAlive = await bridge.runSimulation({ runId: 'trial', action: 'step', artifact, tick: 1, dt: 1 / 60 })
      const runaway = await bridge.runSimulation({ runId: 'runaway', action: 'init', artifact: { ...artifact, source: 'while(true){}' }, tick: 0 })
      const recovery = await bridge.runSimulation({ runId: 'recovery', action: 'init', artifact, tick: 0, values: { start: 9 } })
      const replay = { artifact, state: {}, tick: 2, values: { start: 7 }, initialValues: { start: 5 }, inputs: [{ tick: 1, values: { start: 7 } }] }
      const restored = await bridge.runSimulation({ runId: 'restored', action: 'init', artifact, tick: 2, replay })
      // Keep the 1.9MB worker/persistence bound while using numerical state.
      // Arbitrary new prose cannot inherit an approved source's receipt.
      const largeArtifact = { ...artifact, id: 'large', controls: [], source: 'globalThis.simulation={init(){return{data:"0".repeat(1900000),tick:0}},step(s,t){s.tick=t;return s},input(s){return s},render(){return{entities:[]}}};/*' + 'x'.repeat(250000) + '*/' }
      const lesson = await bridge.createSession('Large experiment persistence trial')
      await bridge.saveScene({sessionId:lesson.id,scene:[],controls:{},simulation:{artifact:largeArtifact,state:null,tick:0,values:{},initialValues:{},inputs:[]}})
      const largeInit = await bridge.runSimulation({ runId: 'large', action: 'init', artifact: largeArtifact, tick: 0 })
      if (largeInit.error) throw new Error(largeInit.error)
      const largeStep = await bridge.runSimulation({ runId: 'large', action: 'step', artifact: largeArtifact, tick: 0 })
      if (largeStep.error) throw new Error(largeStep.error)
      const checkpoint = { artifact: largeArtifact, state: largeStep.state, tick: 1, values: {}, initialValues: {}, inputs: [] }
      await bridge.saveScene({ sessionId: lesson.id, scene: [], controls: {}, simulation: checkpoint })
      const saved = await bridge.loadSession(lesson.id)
      const largeReplay = await bridge.runSimulation({ runId: 'large-restored', action: 'init', artifact: largeArtifact, tick: 1, replay: saved.simulation })
      if (largeReplay.error) throw new Error(largeReplay.error)
      return { initial, stepped, probe, preflight, rejectedPreflight, missingMethod, stillAlive, runaway, recovery, restored, large: { savedLength: saved.simulation.state.data.length, replayLength: largeReplay.state.data.length, tick: largeReplay.state.tick } }
    })
    expect(results.initial.error, diagnostics.join('\n')).toBeUndefined()
    expect(results.initial.entities[0].x).toBe(5)
    expect(results.stepped.entities[0].x).toBeCloseTo(5 + 1 / 60)
    expect(results.probe.error,diagnostics.join('\n')).toBeUndefined()
    expect(results.probe.entities[0].text).toBe('undefined,undefined,undefined,undefined,undefined')
    expect(results.preflight.error).toBeUndefined()
    expect(results.rejectedPreflight.error).toMatch(/failed|budget|time/i)
    expect(results.missingMethod.error).toMatch(/failed|budget|time/i)
    expect(results.stillAlive.entities[0].x).toBeCloseTo(5 + 2 / 60)
    expect(results.runaway.error).toMatch(/failed|budget|time/i)
    expect(results.recovery.entities[0].x).toBe(9)
    expect(results.restored.entities[0].x).toBeCloseTo(7 + 1 / 60)
    expect(results.large).toEqual({ savedLength: 1900000, replayLength: 1900000, tick: 1 })
    const counts=await nativeSafetyCounts(app);expect(counts.classifierRequests).toBeGreaterThan(0);expect(counts.generationRequests).toBe(0);expect(counts.unexpectedFetches).toBe(0)
    const sandbox = await app.evaluate(async ({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows()
      const hidden = windows.find(window => window.webContents.getURL().endsWith('simulation.html'))!
      return { visible: hidden.isVisible(), separateProcess: windows.filter(window => window !== hidden).every(window => window.webContents.getOSProcessId() !== hidden.webContents.getOSProcessId()),
        globals: await hidden.webContents.executeJavaScript('[typeof require,typeof process,typeof livingCanvas]'),
        network: await hidden.webContents.executeJavaScript('fetch("https://example.com").then(()=>"allowed",()=>"denied")') }
    })
    expect(sandbox).toEqual({ visible: false, separateProcess: true, globals: ['undefined', 'undefined', 'undefined'], network: 'denied' })
  } finally { await app.close();if(resolve(directory).startsWith(resolve(tempRoot)+sep))rmSync(directory, { recursive: true, force: true }) }
})
