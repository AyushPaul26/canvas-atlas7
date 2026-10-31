import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

test('reopening the app restores the original window instead of silently exiting', async () => {
  test.setTimeout(45000);
  const root = join(process.cwd(), '.test-tmp');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'startup-activation-'));
  const executablePath = process.env.LIVING_CANVAS_PACKAGED_EXE;
  const args = executablePath ? [] : [join(process.cwd(), 'apps/desktop/out/main/app.js')];
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    LIVING_CANVAS_USER_DATA: directory,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  const duplicates: ChildProcess[] = [];
  const diagnostics = new Map<ChildProcess, { stdout: string; stderr: string; error?: string }>();
  const expectDuplicateExit = async (duplicate: ChildProcess, stage: string) => {
    try {
      await expect.poll(() => duplicate.exitCode, { timeout: 10000, message: `${stage}: duplicate launch exits cleanly` }).toBe(0);
    } catch (error) {
      const windows = await Promise.race([
        app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused() }))).catch(() => 'unavailable'),
        new Promise(resolve => setTimeout(() => resolve('main process did not respond within 2s'), 2000)),
      ]);
      console.error('Startup relaunch diagnostic:', JSON.stringify({ stage, pid: duplicate.pid, exitCode: duplicate.exitCode, signalCode: duplicate.signalCode, windows, ...diagnostics.get(duplicate) }));
      throw error;
    }
  };
  try {
    app = await electron.launch({ executablePath, args, env });
    const binary = await app.evaluate(() => process.execPath);
    const relaunch = () => {
      const duplicate = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      const output = { stdout: '', stderr: '' } as { stdout: string; stderr: string; error?: string };
      duplicate.stdout?.on('data', chunk => { output.stdout = (output.stdout + chunk.toString()).slice(-2000); });
      duplicate.stderr?.on('data', chunk => { output.stderr = (output.stderr + chunk.toString()).slice(-2000); });
      duplicate.on('error', error => { output.error = error.message; });
      diagnostics.set(duplicate, output);
      duplicates.push(duplicate);
      return duplicate;
    };
    // Relaunch before waiting for renderer readiness, as rapid Start clicks can do.
    const earlyDuplicate = relaunch();
    const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Canvas Atlas home' })).toBeVisible();
    await expectDuplicateExit(earlyDuplicate, 'before renderer readiness');
    const windowId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
    const windowState = () => app!.evaluate(({ BrowserWindow }, id) => {
      const window = BrowserWindow.fromId(id);
      return {
        count: BrowserWindow.getAllWindows().filter(candidate => !candidate.isDestroyed()).length,
        visible: window?.isVisible() ?? false,
        minimized: window?.isMinimized() ?? false,
        focused: window?.isFocused() ?? false,
      };
    }, windowId);
    expect(await windowState()).toMatchObject({ count: 1, visible: true, minimized: false });

    for (const action of ['minimize', 'hide'] as const) {
      await app.evaluate(({ BrowserWindow }, { id, action }) => {
        const window = BrowserWindow.fromId(id)!;
        window[action]();
      }, { id: windowId, action });
      await expect.poll(windowState).toMatchObject(action === 'minimize' ? { minimized: true } : { visible: false });
      const duplicate = relaunch();
      await expectDuplicateExit(duplicate, action);
      await expect.poll(windowState, { timeout: 10000 }).toEqual({ count: 1, visible: true, minimized: false, focused: true });
      await expect(page.getByRole('button', { name: 'Canvas Atlas home' })).toBeVisible();
    }
  } finally {
    for (const duplicate of duplicates) if (duplicate.exitCode === null) duplicate.kill();
    if (app) {
      // Start the normal save/close handshake before disconnecting Playwright's inspector.
      await app.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.close();
      }).catch(() => {});
      await app.close().catch(() => {});
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
