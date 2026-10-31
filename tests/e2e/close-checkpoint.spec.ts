import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

test('normal OS window close saves a playing experiment without manual edits', async () => {
  const root = join(process.cwd(), '.test-tmp'); mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(join(root, 'close-trial-'))
  const launch = () => electron.launch({ args: [join(process.cwd(), 'apps/desktop/out/main/app.js')], env: { ...process.env, LIVING_CANVAS_USER_DATA: directory } })
  let app: ElectronApplication | undefined
  try {
    app = await launch(); let page = await app.firstWindow()
    await expect(page.getByRole('button', { name: 'Canvas Atlas home' })).toBeVisible()
    const id = await page.evaluate(async () => {
      const bridge = (window as any).livingCanvas
      const lesson = await bridge.createSession('Close checkpoint trial')
      const artifact = { id: 'close-trial', title: 'Checkpoint trial', source: `globalThis.simulation={init(){return{x:0}},step(s,t,dt){return{x:s.x+dt}},input(s){return s},render(s){return{entities:[{id:'point',kind:'circle',x:s.x,y:0,radius:3}],measurements:{elapsed:s.x}}}}`, controls: [], assumptions: ['Test program'], validation: 'illustrative' }
      await bridge.saveScene({ sessionId: lesson.id, scene: [], controls: {}, simulation: { artifact, state: { x: 0 }, tick: 0, values: {}, initialValues: {}, inputs: [] } })
      return lesson.id
    })
    await page.reload()
    await page.getByText('Close checkpoint trial', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Play experiment' }).click()
    await expect.poll(async () => Number(await page.locator('.measurements strong').textContent())).toBeGreaterThan(.1)
    const closed = app.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.isVisible())!.close())
    await closed; app = undefined
    app = await launch(); page = await app.firstWindow()
    await expect(page.getByRole('button', { name: 'Canvas Atlas home' })).toBeVisible()
    const saved = await page.evaluate(id => (window as any).livingCanvas.loadSession(id), id)
    expect(saved.simulation.tick).toBeGreaterThan(0)
    expect(saved.simulation.state.x).toBeGreaterThan(.1)
  } finally { await app?.close().catch(() => {}); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})
