import { _electron as electron } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { parseLiveConfiguration, prepareTeachingTrial, installLiveDiagnostics } from './live-eval-helpers.mjs';

// Opt-in, bounded two-stage trial through the app's existing authorization.
// Supply an isolated profile explicitly. Never copy a normal user profile or
// supply API keys through this script/environment; connect directly in Settings.
const profile = process.env.CANVAS_ATLAS_LIVE_PROFILE;
const output = resolve(process.env.CANVAS_ATLAS_EVAL_OUTPUT ?? join('.test-tmp', 'visual-companion', 'live-model-trial.json'));
const errorCodes = new Set(['TRIAL_INVALID_PROVIDER', 'TRIAL_INVALID_MODEL', 'TRIAL_PROVIDER_UNSUPPORTED', 'TRIAL_PROVIDER_CHANGED', 'TRIAL_CONNECTION_TIMEOUT', 'TRIAL_CHATGPT_AUTH_REQUIRED', 'TRIAL_CONNECTION_REQUIRED', 'TRIAL_CATALOG_EMPTY', 'TRIAL_MODEL_UNAVAILABLE', 'TRIAL_NOT_READY', 'TRIAL_MODEL_CHANGED', 'TRIAL_TEACHING_TIMEOUT', 'TRIAL_TEACHING_FAILED']);

async function main() {
  if (!profile) {
    console.error('Set CANVAS_ATLAS_LIVE_PROFILE to an authorized isolated profile for the bounded roadmap/teaching trial.');
    process.exitCode = 2;
    return;
  }
  let config;
  try { config = parseLiveConfiguration(process.env); }
  catch (error) {
    console.error(JSON.stringify({ errorCode: errorCodes.has(error?.message) ? error.message : 'TRIAL_INVALID_CONFIGURATION' }));
    process.exitCode = 2;
    return;
  }
  let app;
  try {
    app = await electron.launch({ args: [resolve('apps/desktop/out/main/app.js')], env: { ...process.env, LIVING_CANVAS_USER_DATA: resolve(profile) } });
    const page = await app.firstWindow({ timeout: 60000 });
    await page.getByRole('button', { name: 'Canvas Atlas home' }).waitFor();
    await app.evaluate(installLiveDiagnostics);
    if (config.waitForConnection) {
      await page.bringToFront();
      await page.getByRole('button', { name: 'Open settings' }).click();
      console.log(config.providerId === 'chatgpt'
        ? 'Waiting up to five minutes for the normal Connect ChatGPT sign-in and plan permission in the isolated test app…'
        : `Waiting up to five minutes for a ${config.providerId} key connection entered directly in the isolated app Settings…`);
    }
    await page.evaluate(providerId => { window.__atlasLiveState = { providerId, stage: 'connection' }; }, config.providerId);
    const selection = await page.evaluate(prepareTeachingTrial, config);
    const report = await page.evaluate(async ({ selection, reusePlan }) => {
      const bridge = window.livingCanvas;
      const { providerId, selectedModel: model } = selection;
      window.__atlasLiveState = { providerId, selectedModel: model, stage: 'planning' };
      const topic = 'Teach me how gravitational attraction changes with mass and distance, using a visual demonstration and a checked doubling-distance example.';
      let session;
      // Reuse only sessions with matching service/model provenance. A reused
      // plan is reported explicitly and does not establish fresh planning.
      if (reusePlan) for (const recent of await bridge.getSessions()) {
        const saved = await bridge.loadSession(recent.id);
        const matchingRun = saved.modelRuns?.some(run => (run.providerId ?? 'chatgpt') === providerId && run.requestedModel === model.id);
        if (saved.topic === topic && saved.plan?.concepts.length && matchingRun) { session = saved; break; }
      }
      session ??= await bridge.createSession(topic);
      const reusedPlan = Boolean(session.plan);
      const started = performance.now();
      const plan = session.plan ?? await bridge.planTopic({ sessionId: session.id });
      const planningMs = Math.round(performance.now() - started);
      window.__atlasLiveState = { providerId, selectedModel: model, stage: 'teaching', concepts: plan.concepts.length };
      // A connection changed through Settings must not reroute this trial.
      const current = await bridge.getStatus();
      if (current.teachingProvider && current.teachingProvider !== providerId) throw new Error('TRIAL_PROVIDER_CHANGED');
      if (current.model !== undefined && current.model !== model.id) throw new Error('TRIAL_MODEL_CHANGED');
      const beats = []; let timer; let unsubscribe;
      const prepared = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('TRIAL_TEACHING_TIMEOUT')), 180000);
        unsubscribe = bridge.onEvent(event => {
          if (event.sessionId !== session.id) return;
          if (event.type === 'beat') beats.push(event.beat);
          if (event.type === 'error') reject(new Error('TRIAL_TEACHING_FAILED'));
          if (event.type === 'done') resolve();
        });
      });
      const teachingStart = performance.now();
      // Attach a rejection handler before awaiting startConcept, which may itself
      // reject after the asynchronous error event has already arrived.
      const completed = Promise.all([prepared, bridge.startConcept({ sessionId: session.id, conceptId: plan.concepts[0].id })]);
      try { await completed; }
      finally { clearTimeout(timer); unsubscribe?.(); await bridge.interrupt(session.id); }
      const saved = await bridge.loadSession(session.id);
      const modelRuns = saved.modelRuns?.map(run => ({
        providerId: run.providerId ?? 'chatgpt', requestedModel: run.requestedModel,
        ...(run.servedModel ? { servedModel: run.servedModel } : {}), completedAt: run.completedAt,
      }));
      return { providerId, selectedModel: model, reusedPlan, planningMs, preparationMs: Math.round(performance.now() - teachingStart), plan, beats, modelRuns, acknowledgedBeatCount: saved.beats.length, note: 'Prepared output is separate from heard progress. A reused plan does not establish fresh planning. This bounded trial does not establish complete lesson quality.' };
    }, { selection, reusePlan: process.env.CANVAS_ATLAS_REUSE_PLAN === '1' });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ providerId: report.providerId, selectedModel: report.selectedModel, reusedPlan: report.reusedPlan, concepts: report.plan.concepts.length, preparedBeats: report.beats.length, chunks: report.beats.reduce((sum, beat) => sum + (beat.chunks?.length ?? 0), 0), cues: report.beats.reduce((sum, beat) => sum + (beat.cues?.length ?? 0), 0), planningMs: report.planningMs, preparationMs: report.preparationMs, modelRuns: report.modelRuns, acknowledgedBeatCount: report.acknowledgedBeatCount, report: output }));
  } catch (error) {
    const page = app?.windows()[0];
    const state = page ? await page.evaluate(() => window.__atlasLiveState ?? { stage: 'startup' }).catch(() => ({ stage: 'startup' })) : { stage: 'startup' };
    const network = app ? await app.evaluate(() => globalThis.__atlasNetworkDiagnostics ?? []).catch(() => []) : [];
    // Never copy a provider's raw error message into output. Playwright prefixes
    // serialized errors, so match only our fixed local diagnostic tokens.
    const candidate = error instanceof Error ? error.message.match(/\bTRIAL_[A-Z_]+\b/)?.[0] : undefined;
    const failure = { ...state, providerId: config.providerId, ...(config.modelId ? { requestedModel: config.modelId } : {}), errorCode: errorCodes.has(candidate) ? candidate : 'TRIAL_FAILED', network };
    const failureOutput = resolve('.test-tmp/visual-companion/live-model-trial-failure.json');
    await mkdir(dirname(failureOutput), { recursive: true });
    await writeFile(failureOutput, JSON.stringify(failure, null, 2));
    console.error(JSON.stringify(failure));
    process.exitCode = 1;
  } finally { await app?.close(); }
}

await main();
