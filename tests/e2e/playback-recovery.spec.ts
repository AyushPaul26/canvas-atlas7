import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlaybackCheckpoint, SceneEntity } from '@living-canvas/protocol';

type FixtureState = {
  stats: { plans: number; starts: number; complete: number; continues: number; audioRequests: string[]; resumes: { mode: string; checkpoint: PlaybackCheckpoint }[] };
  checkpoints: Record<string, PlaybackCheckpoint>;
  sessions: { id: string; scene: SceneEntity[]; messages: { text: string }[] }[];
};
const state = (app: ElectronApplication) => app.evaluate(() => (globalThis as typeof globalThis & { __atlasFixture: FixtureState }).__atlasFixture);
const massX = (entities: SceneEntity[]) => entities.find(entity => entity.id === 'mass-b')?.x;

async function open(directory: string) {
  const app = await electron.launch({ args: [join(process.cwd(), 'tests/fixtures/learning-shell.mjs')], env: { ...process.env, ATLAS_FIXTURE_ROOT: directory } });
  const page = await app.firstWindow();
  await expect(page.getByRole('button', { name: 'Canvas Atlas home' })).toBeVisible();
  return { app, page };
}
async function close(app: ElectronApplication) {
  const page = app.windows()[0];
  // Observe the real renderer save/readyToClose handshake before disconnecting
  // Playwright's inspector. Waiting only for process exit can deadlock Node's
  // "Waiting for the debugger to disconnect" shutdown state.
  await Promise.all([
    page.waitForEvent('close', { timeout: 15000 }),
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close()),
  ]);
  await app.close();
}

test('reopening a paused lesson retains its accepted baseline and heard prefix, then completes once from real PCM', async () => {
  test.setTimeout(60000);
  const root = join(process.cwd(), '.test-tmp'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'playback-recovery-'));
  let app: ElectronApplication | undefined;
  try {
    const first = await open(directory); app = first.app;
    await first.page.getByRole('button', { name: /Start learning/ }).click();
    await first.page.getByLabel('What would you like to learn today?').fill('Recover this gravitation lesson');
    await first.page.getByRole('button', { name: 'Create roadmap' }).click();
    await first.page.getByRole('button', { name: 'Start Teaching' }).first().click();
    await expect.poll(async () => (await state(app!)).checkpoints['session-1']?.completedChunkIds, { timeout: 15000, intervals: [50, 100] }).toEqual(['attraction']);
    // Allow part of the second PCM chunk and its tween to run before pausing.
    await first.page.waitForTimeout(250);
    await first.page.getByRole('button', { name: 'Pause teaching' }).press('Enter');
    await expect(first.page.getByRole('button', { name: 'Resume teaching' })).toBeEnabled();
    const paused = (await state(app)).checkpoints['session-1'];
    expect(paused.cursor.chunkId).toBe('distance');
    expect(paused.cursor.offsetSeconds).toBeGreaterThan(0);
    expect(paused.cursor.offsetSeconds).toBeLessThan(2);
    expect(paused.completedChunkIds).toEqual(['attraction']);
    expect(paused.receipt).toBeUndefined();
    expect(massX(paused.baselineScene)).toBe(620);
    expect(massX(paused.visibleScene)).toBeGreaterThan(620);
    expect(massX(paused.visibleScene)).toBeLessThan(760);
    expect(paused.appliedCueIds).toEqual(expect.arrayContaining(['hide-equation', 'show-equation', 'move-mass']));
    expect((await state(app)).stats.complete).toBe(0);
    await close(app); app = undefined;

    const persisted: FixtureState = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
    expect(persisted.checkpoints['session-1'].completedChunkIds).toEqual(['attraction']);
    expect(massX(persisted.checkpoints['session-1'].baselineScene)).toBe(620);
    const reopened = await open(directory); app = reopened.app;
    await reopened.page.getByRole('button', { name: /Recover this gravitation lesson/ }).first().click();
    await expect(reopened.page.getByRole('button', { name: 'Resume teaching' })).toBeEnabled();
    expect((await state(app)).stats.complete).toBe(0);
    const requestsBefore = (await state(app)).stats.audioRequests.length;
    await reopened.page.getByRole('button', { name: 'Resume teaching' }).click();
    await expect.poll(async () => (await state(app!)).stats.complete, { timeout: 15000 }).toBe(1);
    const completed = await state(app), checkpoint = completed.checkpoints['session-1'];
    expect(completed.stats.plans).toBe(1); expect(completed.stats.starts).toBe(1); expect(completed.stats.continues).toBe(0);
    expect(completed.stats.resumes[0].checkpoint.completedChunkIds).toEqual(['attraction']);
    expect(completed.stats.resumes[0].checkpoint.baselineScene).toEqual(paused.baselineScene);
    // Across a process restart, only the interrupted chunk restarts from its beginning.
    expect(completed.stats.audioRequests.slice(requestsBefore)).toEqual(['Double the distance and the force falls to one quarter.']);
    expect(checkpoint.completedChunkIds).toEqual(['attraction', 'distance']);
    expect(checkpoint.receipt).toMatchObject({ audioResult: 'completed', visualComplete: true, completedChunkIds: ['attraction', 'distance'] });
    expect(checkpoint.cursor.passId).not.toBe(paused.cursor.passId);
    expect(massX(checkpoint.baselineScene)).toBe(620); expect(massX(checkpoint.visibleScene)).toBe(760);
    await expect(reopened.page.getByText('What happens to force when distance doubles?', { exact: true })).toBeVisible();
    await reopened.page.getByRole('button', { name: 'Replay', exact: true }).click();
    await expect(reopened.page.getByRole('group', { name: 'Teaching playback' }).getByText('Teaching step heard')).toBeVisible({ timeout: 15000 });
    const replayed = await state(app);
    expect(replayed.stats.complete).toBe(1); expect(replayed.stats.starts).toBe(1); expect(replayed.stats.continues).toBe(0);
    expect(replayed.checkpoints['session-1'].receipt).toEqual(checkpoint.receipt);
    expect(replayed.sessions[0].messages).toHaveLength(1);
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
