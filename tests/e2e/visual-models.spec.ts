import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {installNativeSafety,nativeSafetyCounts} from '../fixtures/native-safety';

const math = { id: 'coordinates', title: 'Explore a position vector', engine: 'model', source: JSON.stringify({ version: 1, kind: 'math', bounds: { left: -4, right: 4, bottom: -4, top: 4 }, axes: { xLabel: 'x', yLabel: 'y' }, points: [{ id: 'origin', label: 'Origin', x: 0, y: 0 }, { id: 'p', label: 'P', x: { control: 'px' }, y: { control: 'py' }, drag: { xControl: 'px', yControl: 'py' } }], plots: [{ id: 'slope', label: 'Line through P', expression: { op: 'multiply', args: [{ op: 'divide', args: [{ control: 'py' }, { control: 'px' }] }, { variable: 'x' }] }, domain: { min: -4, max: 4 } }], vectors: [{ id: 'position', label: 'Position vector', from: 'origin', to: 'p' }] }), controls: [{ id: 'px', label: 'Horizontal position', type: 'number', value: 2, min: .5, max: 4, step: .1 }, { id: 'py', label: 'Vertical position', type: 'number', value: 1, min: -4, max: 4, step: .1 }], assumptions: ['Equal coordinate units.'], validation: 'illustrative' };
const physics = { id: 'mechanics', title: 'A falling rigid body', engine: 'model', source: JSON.stringify({ version: 1, kind: 'physics', gravity: { x: 0, y: 9.81 }, bodies: [{ id: 'ball', shape: 'circle', x: 2, y: 1, radius: .2, label: 'Ball' }, { id: 'floor', shape: 'rect', x: 4, y: 5, width: 8, height: .2, isStatic: true }], joints: [], bindings: [{ controlId: 'g', target: 'gravityY' }] }), controls: [{ id: 'g', label: 'Gravity', type: 'number', value: 9.81, min: 0, max: 20 }], assumptions: ['Uniform gravity; approximate rigid-body contacts.'], validation: 'illustrative' };
const launch = (directory: string) => { const executablePath = process.env.LIVING_CANVAS_PACKAGED_EXE; return electron.launch({ executablePath, args: executablePath ? [] : [join(process.cwd(), 'apps/desktop/out/main/app.js')], env: { ...process.env, LIVING_CANVAS_USER_DATA: directory } }); };

test('trusted graph uses real JSXGraph drag, one atomic saved input, keyboard controls and restart replay', async () => {
  test.setTimeout(90000);
  const root = resolve('.test-tmp/visual-refinement'); await mkdir(root, { recursive: true }); const directory = await mkdtemp(join(root, 'graph-'));
  let app: ElectronApplication | undefined = await launch(directory);
  try {
    await installNativeSafety(app);
    let page = await app.firstWindow(); await page.getByRole('button', { name: 'Canvas Atlas home' }).waitFor();
    const id = await page.evaluate(async artifact => {
      const api = (window as any).livingCanvas, values = { px: 2, py: 1 };
      const initial = await api.runSimulation({ runId: 'graph-seed', action: 'init', tick: 0, artifact, values });
      if (initial.error) throw new Error(initial.error);
      const session = await api.createSession('Coordinate exploration');
      await api.saveScene({ sessionId: session.id, scene: initial.entities, controls: values, simulation: { artifact, state: initial.state, tick: 0, values, initialValues: values, inputs: [] } });
      return session.id;
    }, math);
    await page.reload(); await page.getByRole('button', { name: 'Coordinate exploration', exact: true }).click();
    await page.getByRole('button', { name: 'Explore graph' }).click();
    await expect(page.locator('.math-stage-board svg')).toBeVisible(); await expect(page.getByLabel('P x', { exact: true })).toHaveValue('2');
    const graph = page.getByLabel('Maths graph', { exact: true });
    await graph.scrollIntoViewIfNeeded();
    const visibleGraphHeight = () => graph.evaluate(element => {
      const rect = element.getBoundingClientRect(); let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) { const clip = parent.getBoundingClientRect(); top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
      }
      return Math.max(0, bottom - top);
    });
    await expect.poll(visibleGraphHeight).toBeGreaterThan(220);
    const marker = page.locator('.math-stage-board svg [fill="#C3E9D7"]').last();
    await expect(marker).toBeVisible(); const bounds = await marker.boundingBox(); if (!bounds) throw new Error('Missing draggable graph point');
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 36, bounds.y + bounds.height / 2 - 24, { steps: 8 }); await page.mouse.up();
    const saved = () => page.evaluate(sessionId => (window as any).livingCanvas.loadSession(sessionId), id);
    await expect.poll(async () => (await saved()).simulation.inputs.length).toBe(1);
    const dragged = await saved(); expect(dragged.controls.px).toBeGreaterThan(2); expect(dragged.controls.py).toBeGreaterThan(1);
    expect(dragged.simulation.inputs[0].values).toEqual(dragged.controls);
    const keyboardX = dragged.controls.px === 3.5 ? 1.5 : 3.5;
    await page.getByLabel('P x', { exact: true }).fill(String(keyboardX)); await page.getByLabel('P x', { exact: true }).press('Enter');
    await expect.poll(async () => (await saved()).controls.px).toBe(keyboardX);
    await expect.poll(async () => (await saved()).simulation.inputs.length).toBe(2);
    await graph.scrollIntoViewIfNeeded(); await expect.poll(visibleGraphHeight).toBeGreaterThan(220);
    await page.screenshot({ path: join(root, 'graph-exploration.png') });
    await page.getByRole('button', { name: 'Diagram', exact: true }).click(); await expect(page.locator('.canvas-stage')).toBeVisible();
    const online=await nativeSafetyCounts(app);expect(online.classifierRequests).toBeGreaterThan(0);expect(online.generationRequests).toBe(0);expect(online.unexpectedFetches).toBe(0);
    await page.evaluate(()=>(window as any).livingCanvas.clearTeachingKey('groq'));
    await app.close(); app = await launch(directory);await installNativeSafety(app,true); page = await app.firstWindow();
    await page.getByRole('button', { name: 'Coordinate exploration', exact: true }).click(); await page.getByRole('button', { name: 'Explore graph' }).click();
    await expect(page.getByLabel('P x', { exact: true })).toHaveValue(String(keyboardX)); await expect(page.getByLabel('P y', { exact: true })).toHaveValue(String(dragged.controls.py));
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 720, height: 720 });
    // Below 760px the established layout uses natural document scrolling.
    await page.getByLabel('Ask your teacher a question').scrollIntoViewIfNeeded();
    await expect(page.getByLabel('Ask your teacher a question')).toBeInViewport();
    await page.getByLabel('P x', { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByLabel('P x', { exact: true })).toBeInViewport();
    await page.screenshot({ path: join(root, 'graph-compact.png'), fullPage: true });
    expect(await nativeSafetyCounts(app)).toEqual({catalogRequests:0,classifierRequests:0,generationRequests:0,unexpectedFetches:0,blockedHttp:0});
  } finally { await app?.close(); const target = resolve(directory); if (target.startsWith(root + sep)) await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('trusted Matter worker preserves fixed-step mechanics, local input and persisted replay', async () => {
  test.setTimeout(60000);
  const root = resolve('.test-tmp/visual-refinement'); await mkdir(root, { recursive: true }); const directory = await mkdtemp(join(root, 'physics-'));
  const app = await launch(directory);
  try {
    await installNativeSafety(app);
    const page = await app.firstWindow(); await page.getByRole('button', { name: 'Canvas Atlas home' }).waitFor();
    const results = await page.evaluate(async artifact => {
      const api = (window as any).livingCanvas;
      const run = async (runId: string, action: string, tick: number, extra: object = {}) => { const result = await api.runSimulation({ runId, action, tick, dt: 1 / 60, artifact, ...extra }); if (result.error) throw new Error(result.error); return result; };
      const initial = await run('mechanics-native', 'init', 0, { values: { g: 9.81 } });
      let expected = initial;
      for (let tick = 0; tick < 60; tick++) { if (tick === 30) await run('mechanics-native', 'input', tick, { values: { g: 0 } }); expected = await run('mechanics-native', 'step', tick); }
      const session = await api.createSession('Mechanics replay');
      const simulation = { artifact, state: expected.state, tick: 60, values: { g: 0 }, initialValues: { g: 9.81 }, inputs: [{ tick: 30, values: { g: 0 } }] };
      await api.saveScene({ sessionId: session.id, scene: expected.entities, controls: { g: 0 }, simulation });
      const saved = await api.loadSession(session.id);
      const restored = await run('mechanics-restored', 'init', 60, { replay: saved.simulation });
      return { initial, expected, restored, next: await run('mechanics-restored', 'step', 60), originalNext: await run('mechanics-native', 'step', 60) };
    }, physics);
    expect(results.initial.state.bodies[0].y).toBe(1); expect(results.expected.state.bodies[0].y).toBeGreaterThan(2);
    expect(results.restored).toEqual(results.expected); expect(results.next).toEqual(results.originalNext);
    expect(results.expected.measurements.time_s).toBe(1);
    const counts=await nativeSafetyCounts(app);expect(counts.classifierRequests).toBeGreaterThan(0);expect(counts.generationRequests).toBe(0);expect(counts.unexpectedFetches).toBe(0);
  } finally { await app.close(); const target = resolve(directory); if (target.startsWith(root + sep)) await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
