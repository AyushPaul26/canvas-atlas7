/** Test-only browser harness; no fixtures are included in the product entry. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';

const server = await createServer({ configFile: 'apps/desktop/vite.web.config.ts', server: { port: 5175, host: '127.0.0.1' } });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const results = [];
const errors = [];
await mkdir('docs/frontend-evidence', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5175');
  await page.getByRole('button', { name: 'Start learning' }).click();
  await page.getByLabel('What would you like to learn today?').fill('How does curiosity become understanding?');
  await page.getByRole('button', { name: 'Connect ChatGPT', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert(await page.getByRole('dialog').getByRole('button', { name: 'Connect ChatGPT', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Close dialog' }).click();
  assert.equal(await page.getByLabel('What would you like to learn today?').inputValue(), 'How does curiosity become understanding?');
  results.push('Disconnected topic is preserved; browser sign-in clearly unavailable.');
  await page.screenshot({ path: 'docs/frontend-evidence/topic-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/frontend-evidence/topic-narrow.png', fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('button', { name: 'Canvas Atlas home' }).click();
  await page.screenshot({ path: 'docs/frontend-evidence/home-narrow.png', fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  results.push('390px home and topic layouts have no horizontal overflow.');

  // Only the verification page receives this explicit in-memory bridge fixture.
  const lesson = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  lesson.on('pageerror', (error) => errors.push(error.message));
  await lesson.addInitScript(() => {
    let subscriber = () => {};
    const sessions = [];
    const log = { messages: [], saves: [], simulations: [], interrupts: [] };
    const status = { connected: true, planEnabled: true, desktop: true, model: 'test-model', account: { id: 'test-account', name: 'Test learner' } };
    window.__testLog = log;
    window.__emitTestEvent = (event) => subscriber(event);
    window.livingCanvas = {
      getStatus: async () => status, signIn: async () => status, signOut: async () => ({ ...status, connected: false }),
      getModels: async () => [{ id: 'test-model', name: 'Test model' }], setModel: async () => status,
      getSessions: async () => sessions.map((item) => ({ ...item, messageCount: item.messages.length })),
      loadSession: async (id) => sessions.find((item) => item.id === id),
      createSession: async (topic) => { const now = new Date().toISOString(); const item = { id: 'browser-test-session', title: topic, topic, createdAt: now, updatedAt: now, messages: [], beats: [], scene: [], controls: {} }; sessions.push(item); return item; },
      readyToClose: async () => {}, presentProgress: async () => {}, sendMessage: async (input) => { log.messages.push(input); }, interrupt: async (id) => { log.interrupts.push(id); },
      saveScene: async (input) => { log.saves.push(input); const item = sessions.find((item) => item.id === input.sessionId); Object.assign(item, { scene: input.scene, controls: input.controls }); },
      deleteSession: async (id) => { const index = sessions.findIndex((item) => item.id === id); sessions.splice(index, 1); },
      exportLesson: async () => ({ canceled: false, path: 'test-export.html' }),
      onEvent: (fn) => { subscriber = fn; return () => { subscriber = () => {}; }; },
      voiceStatus: async () => ({ recognitionReady: false, synthesisReady: false }), onVoiceProgress: () => () => {},
      installVoiceModel: async () => ({ recognitionReady: false, synthesisReady: false }),
      transcribeAudio: async () => { throw Error('Test has no microphone'); }, synthesizeSpeech: async () => null,
      runSimulation: async (input) => { log.simulations.push(input); return { state: { tick: input.tick }, entities: [{ id: 'sim:marker', kind: 'circle', x: 120 + Number(input.values.distance ?? 1) * 50, y: 280, radius: 25, fill: '#C3E9D7' }], measurements: { distance: Number(input.values.distance ?? 1) } }; },
    };
  });
  await lesson.goto('http://127.0.0.1:5175');
  await lesson.getByRole('button', { name: 'Start learning' }).click();
  await lesson.getByLabel('What would you like to learn today?').fill('Browser verification lesson');
  await lesson.getByRole('button', { name: 'Begin lesson', exact: true }).click();
  await lesson.getByLabel('Lesson conversation').waitFor();
  await lesson.getByRole('button', { name: 'Mute teacher voice' }).click();
  assert.equal(await lesson.evaluate(() => window.__testLog.messages.length), 1);
  await lesson.evaluate(() => window.__emitTestEvent({ type: 'beat', sessionId: 'browser-test-session', epoch: 1, beat: { id: 'test-beat', narration: 'This is a verification fixture for the editable canvas and equation overlay.', canvas: { mode: 'replace', entities: [{ id: 'title', kind: 'text', x: 80, y: 60, text: 'An idea, made visible', fontSize: 34 }, { id: 'shape', kind: 'rect', x: 100, y: 180, width: 180, height: 110, fill: '#EAE9FB', label: 'Idea' }, { id: 'arrow', kind: 'arrow', x: 300, y: 230, points: [0, 0, 140, 0] }, { id: 'circle', kind: 'circle', x: 520, y: 230, radius: 70, fill: '#C3E9D7' }, { id: 'equation', kind: 'equation', x: 100, y: 390, text: 'a^2+b^2=c^2', width: 350, fontSize: 29 }] } } }));
  await lesson.getByText('This is a verification fixture for the editable canvas and equation overlay.').waitFor();
  await lesson.screenshot({ path: 'docs/frontend-evidence/lesson-desktop.png', fullPage: true });
  await lesson.evaluate(() => window.__emitTestEvent({ type: 'status', sessionId: 'browser-test-session', epoch: 1, phase: 'thinking' }));
  await lesson.getByRole('button', { name: 'Pause', exact: true }).click();
  await lesson.evaluate(() => window.__emitTestEvent({ type: 'beat', sessionId: 'browser-test-session', epoch: 1, beat: { id: 'stale-beat', narration: 'STALE SHOULD NOT APPEAR', canvas: { mode: 'replace', entities: [] } } }));
  assert.equal(await lesson.getByText('STALE SHOULD NOT APPEAR').count(), 0);
  await lesson.getByRole('button', { name: 'Add your note' }).click();
  await lesson.getByLabel('Selected object text').fill('A learner annotation');
  await lesson.getByRole('button', { name: /^Save/ }).click();
  await lesson.getByText('Lesson saved on this device.').waitFor();
  assert(await lesson.evaluate(() => window.__testLog.saves.at(-1).scene.some((entity) => entity.text === 'A learner annotation')));
  results.push('Connected test bridge: one initial request, committed scene preserved on pause, stale epoch ignored, editable note saved.');
  await lesson.evaluate(() => window.__emitTestEvent({ type: 'beat', sessionId: 'browser-test-session', epoch: 2, beat: { id: 'experiment-beat', narration: 'This test checks sandbox bridge controls.', canvas: { mode: 'append', entities: [] }, simulation: { id: 'test-program', title: 'Test experiment', source: 'TEST_FIXTURE_NOT_EXECUTED', controls: [{ id: 'distance', type: 'slider', label: 'Distance', value: 1, min: 1, max: 10, step: 1 }], assumptions: ['Browser verification fixture only.'], validation: 'illustrative' } } }));
  await lesson.getByLabel('Experiment controls').waitFor();
  const slider = lesson.getByRole('slider'); await slider.fill('5');
  await lesson.waitForFunction(() => window.__testLog.simulations.some((input) => input.action === 'input' && input.values.distance === 5));
  await lesson.waitForFunction(() => window.__testLog.simulations.some((input) => input.action === 'step' && input.tick > 0));
  await lesson.getByRole('button', { name: 'Pause experiment' }).click();
  results.push('Simulation init/input/step routed through bridge; controls applied immediately.');
  await lesson.setViewportSize({ width: 390, height: 844 });
  await lesson.screenshot({ path: 'docs/frontend-evidence/lesson-narrow.png', fullPage: true });
  assert(await lesson.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await lesson.getByRole('button', { name: 'Open settings' }).click();
  await lesson.getByRole('dialog').getByLabel('Teaching model').selectOption('test-model');
  await lesson.screenshot({ path: 'docs/frontend-evidence/settings-narrow.png', fullPage: true });
  await lesson.keyboard.press('Escape');
  assert.equal(await lesson.getByRole('dialog').count(), 0);
  assert.equal(await lesson.getByRole('button', { name: 'Open settings' }).evaluate((node) => node === document.activeElement), true);
  results.push('390px lesson and modal remain usable; native model selection, Escape and trigger focus restoration verified.');
  await lesson.getByRole('button', { name: 'My lessons', exact: true }).click();
  await lesson.getByRole('button', { name: 'Delete Browser verification lesson' }).click();
  await lesson.getByRole('dialog', { name: 'Delete this lesson?' }).waitFor();
  assert.equal(await lesson.getByRole('button', { name: 'Cancel', exact: true }).evaluate((node) => node === document.activeElement), true);
  await lesson.getByRole('button', { name: 'Delete lesson', exact: true }).click();
  await lesson.getByText('Lesson deleted from this device.').waitFor();
  assert.equal(await lesson.getByRole('button', { name: 'Delete Browser verification lesson' }).count(), 0);
  results.push('Deletion names the lesson, initially focuses Cancel, and refreshes the history after confirmation.');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: results, pageErrors: errors }, null, 2));
  await writeFile('docs/frontend-evidence/browser-results.json', JSON.stringify({ passed: results, pageErrors: errors }, null, 2));
} finally { await browser.close(); await server.close(); }
