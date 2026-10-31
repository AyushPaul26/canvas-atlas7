import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

test('real sign-in discovery reaches the browser handoff through the desktop transport', async () => {
  test.skip(process.env.LIVING_CANVAS_NETWORK_TRIAL !== '1', 'Opt-in public network trial; no account authorization or tokens used')
  const root = join(process.cwd(), '.test-tmp'); mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(join(root, 'auth-network-'))
  const executablePath = process.env.LIVING_CANVAS_PACKAGED_EXE
  const app = await electron.launch({ executablePath, args: executablePath ? [] : [join(process.cwd(), 'apps/desktop/out/main/app.js')], env: { ...process.env, LIVING_CANVAS_USER_DATA: directory } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: 'Canvas Atlas home' })).toBeVisible()
    await app.evaluate(({ shell }) => {
      ;(globalThis as any).__networkTrialHandoff = null
      shell.openExternal = async (target: string) => {
        const url = new URL(target)
        ;(globalThis as any).__networkTrialHandoff = { origin: url.origin, path: url.pathname, appName: url.searchParams.get('agent_name_hint'), callbackHost: new URL(url.searchParams.get('redirect_uri')!).hostname }
      }
    })
    // The opener is intercepted before any browser/account interaction. Only
    // public OIDC discovery is requested; fresh state/nonce/PKCE are not logged.
    const attempt = page.evaluate(async () => { try { await (window as any).livingCanvas.signIn(); return 'connected' } catch { return 'canceled' } })
    await expect.poll(() => app.evaluate(() => (globalThis as any).__networkTrialHandoff), { timeout: 20000 }).toEqual({ origin: 'https://auth.openai.com', path: '/api/accounts/authorize', appName: 'Canvas Atlas', callbackHost: '127.0.0.1' })
    await page.evaluate(() => (window as any).livingCanvas.signOut())
    expect(await attempt).toBe('canceled')
    expect(await page.evaluate(() => (window as any).livingCanvas.getStatus())).toMatchObject({ connected: false })
  } finally { await app.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})
