// These helpers use only public bridge metadata; they never load credentials.
export function parseLiveConfiguration(env) {
  const providerId = env.CANVAS_ATLAS_PROVIDER ?? 'chatgpt';
  if (!['chatgpt', 'gemini', 'groq'].includes(providerId)) throw new Error('TRIAL_INVALID_PROVIDER');
  const modelId = env.CANVAS_ATLAS_MODEL;
  if (modelId !== undefined && (modelId.length > 200 || !/^[A-Za-z0-9][\w:./-]*$/.test(modelId))) throw new Error('TRIAL_INVALID_MODEL');
  return {
    providerId,
    ...(modelId === undefined ? {} : { modelId }),
    waitForConnection: env.CANVAS_ATLAS_WAIT_FOR_CONNECTION === '1' || (providerId === 'chatgpt' && env.CANVAS_ATLAS_WAIT_FOR_SIGNIN === '1'),
  };
}

// Serializable for Playwright page.evaluate; keep this function self-contained.
export async function prepareTeachingTrial(config, bridge = window.livingCanvas) {
  const { providerId, modelId, waitForConnection } = config;
  const pause = () => new Promise(resolve => setTimeout(resolve, 500));
  // Select the requested service before querying its catalog. An exact model can
  // only be selected after that service's public catalog has been loaded.
  if (bridge.selectTeachingProvider) await bridge.selectTeachingProvider({ providerId });
  else if (providerId !== 'chatgpt') throw new Error('TRIAL_PROVIDER_UNSUPPORTED');
  const connectionDeadline = Date.now() + (waitForConnection ? 300000 : 0);
  let status;
  do {
    status = await bridge.getStatus();
    if (status.teachingProvider && status.teachingProvider !== providerId) throw new Error('TRIAL_PROVIDER_CHANGED');
    const connected = providerId === 'chatgpt'
      ? status.connected === true && status.planEnabled === true
      : status.teachingProvider === providerId && status.teachingConnected === true;
    if (connected) break;
    if (Date.now() >= connectionDeadline) throw new Error(waitForConnection ? 'TRIAL_CONNECTION_TIMEOUT' : providerId === 'chatgpt' ? 'TRIAL_CHATGPT_AUTH_REQUIRED' : 'TRIAL_CONNECTION_REQUIRED');
    await pause();
  } while (waitForConnection);

  let models;
  const catalogDeadline = Date.now() + 45000;
  do {
    models = await bridge.getModels();
    if (models.length) break;
    if (Date.now() >= catalogDeadline) throw new Error('TRIAL_CATALOG_EMPTY');
    await pause();
  } while (!models.length);
  let model;
  if (modelId !== undefined) model = models.find(model => model.id === modelId);
  else if (providerId === 'chatgpt') model = models.find(model => /astra/i.test(model.name)) ?? models[0];
  else {
    const configuration = await bridge.getTeachingConfiguration();
    if (configuration.activeProvider !== providerId) throw new Error('TRIAL_PROVIDER_CHANGED');
    const remembered = configuration.connections.find(connection => connection.providerId === providerId)?.model;
    model = remembered === undefined ? models[0] : models.find(model => model.id === remembered);
  }
  if (!model) throw new Error('TRIAL_MODEL_UNAVAILABLE');
  await bridge.setModel(model.id);
  status = await bridge.getStatus();
  if (status.teachingProvider && status.teachingProvider !== providerId) throw new Error('TRIAL_PROVIDER_CHANGED');
  if (providerId === 'chatgpt' && (!status.connected || !status.planEnabled)) throw new Error('TRIAL_CHATGPT_AUTH_REQUIRED');
  if (status.teachingReady === false || (providerId !== 'chatgpt' && (status.teachingProvider !== providerId || status.teachingConnected !== true || status.teachingReady !== true))) throw new Error('TRIAL_NOT_READY');
  if ((status.model !== undefined || providerId !== 'chatgpt') && status.model !== model.id) throw new Error('TRIAL_MODEL_CHANGED');
  return { providerId, selectedModel: { id: model.id, name: model.name } };
}

// Serializable for Electron app.evaluate. Diagnostics are limited to fixed
// service origins/API paths and public status/error tokens; raw messages never
// leave the process. Neither headers nor request bodies are inspected.
export function installLiveDiagnostics({ session }) {
  const network = session.fromPartition('living-canvas-network', { cache: false });
  const request = network.fetch.bind(network);
  globalThis.__atlasNetworkDiagnostics = [];
  network.fetch = async (...args) => {
    const response = await request(...args);
    let providerId;
    try {
      const url = new URL(typeof args[0] === 'string' || args[0] instanceof URL ? args[0] : args[0].url);
      if (url.origin === 'https://api.openai.com' && url.pathname.startsWith('/v1/')) providerId = 'chatgpt';
      if (url.origin === 'https://generativelanguage.googleapis.com' && url.pathname.startsWith('/v1beta/')) providerId = 'gemini';
      if (url.origin === 'https://api.groq.com' && url.pathname.startsWith('/openai/v1/')) providerId = 'groq';
    } catch { /* A non-URL request is outside the diagnostic allowlist. */ }
    if (providerId) {
      const diagnostic = { providerId, status: response.status };
      if (!response.ok) {
        const payload = await response.clone().json().catch(() => undefined);
        for (const key of ['code', 'type', 'param', 'status']) {
          const value = payload?.error?.[key];
          if (typeof value === 'string' && value.length < 200 && /^[\w.[\]:/-]+$/.test(value)) diagnostic[key === 'status' ? 'errorStatus' : key] = value;
          else if (key === 'code' && Number.isInteger(value) && value >= 100 && value <= 599) diagnostic.code = value;
        }
      }
      // The trial is bounded; also cap retained diagnostics independently.
      if (globalThis.__atlasNetworkDiagnostics.length < 100) globalThis.__atlasNetworkDiagnostics.push(diagnostic);
    }
    return response;
  };
}
