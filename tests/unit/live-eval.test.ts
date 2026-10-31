import { afterEach, expect, it, vi } from 'vitest';

const helperPath = '../../scripts/live-eval-helpers.mjs';
const { parseLiveConfiguration, prepareTeachingTrial, installLiveDiagnostics } = await import(helperPath);

afterEach(() => vi.useRealTimers());

function fixture(providerId = 'gemini', overrides: Record<string, unknown> = {}) {
  const models = [{ id: 'first', name: 'First' }, { id: 'exact/model', name: 'Astra' }];
  let selected = 'first';
  const bridge = {
    selectTeachingProvider: vi.fn(async () => undefined),
    getStatus: vi.fn(async () => ({ connected: false, planEnabled: false, teachingProvider: providerId, teachingConnected: true, teachingReady: true, model: selected })),
    getModels: vi.fn(async () => models),
    getTeachingConfiguration: vi.fn(async () => ({ activeProvider: providerId, connections: [{ providerId, connected: true, hasKey: true, model: 'first' }] })),
    setModel: vi.fn(async (id: string) => { selected = id; }),
    ...overrides,
  };
  return { bridge, config: parseLiveConfiguration({ CANVAS_ATLAS_PROVIDER: providerId }) };
}

it('defaults to ChatGPT and restricts provider/model input without reading credentials', () => {
  expect(parseLiveConfiguration({})).toMatchObject({ providerId: 'chatgpt', waitForConnection: false });
  expect(() => parseLiveConfiguration({ CANVAS_ATLAS_PROVIDER: 'grok' })).toThrow('TRIAL_INVALID_PROVIDER');
  expect(() => parseLiveConfiguration({ CANVAS_ATLAS_MODEL: 'bad\nmodel' })).toThrow('TRIAL_INVALID_MODEL');
  expect(parseLiveConfiguration({ CANVAS_ATLAS_PROVIDER: 'groq', CANVAS_ATLAS_WAIT_FOR_SIGNIN: '1' }).waitForConnection).toBe(false);
  expect(parseLiveConfiguration({ CANVAS_ATLAS_WAIT_FOR_SIGNIN: '1' }).waitForConnection).toBe(true);
  expect(parseLiveConfiguration({ CANVAS_ATLAS_PROVIDER: 'gemini', CANVAS_ATLAS_WAIT_FOR_CONNECTION: '1' }).waitForConnection).toBe(true);
});

it.each(['gemini', 'groq'])('prepares %s independently of ChatGPT authorization and never prefers Astra', async providerId => {
  const { bridge, config } = fixture(providerId);
  const result = await prepareTeachingTrial(config, bridge);
  expect(result).toMatchObject({ providerId, selectedModel: { id: 'first' } });
  expect(bridge.selectTeachingProvider).toHaveBeenCalledWith({ providerId });
  expect(bridge.setModel).toHaveBeenCalledWith('first');
  expect(JSON.stringify(result)).not.toContain('hasKey');
});

it('requires the exact requested model and never falls back after a mismatch', async () => {
  const { bridge, config } = fixture();
  await expect(prepareTeachingTrial({ ...config, modelId: 'exact/model' }, bridge)).resolves.toMatchObject({ selectedModel: { id: 'exact/model' } });
  await expect(prepareTeachingTrial({ ...config, modelId: 'EXACT/model' }, bridge)).rejects.toThrow('TRIAL_MODEL_UNAVAILABLE');
});

it('preserves an unavailable remembered API model instead of silently substituting', async () => {
  const { bridge, config } = fixture('groq', { getTeachingConfiguration: async () => ({ activeProvider: 'groq', connections: [{ providerId: 'groq', model: 'removed/model' }] }) });
  await expect(prepareTeachingTrial(config, bridge)).rejects.toThrow('TRIAL_MODEL_UNAVAILABLE');
  expect(bridge.setModel).not.toHaveBeenCalled();
});

it('preserves the legacy ChatGPT Astra preference and plan authorization guard', async () => {
  const { bridge, config } = fixture('chatgpt', { getStatus: async () => ({ connected: true, planEnabled: true }) });
  await expect(prepareTeachingTrial(config, bridge)).resolves.toMatchObject({ selectedModel: { id: 'exact/model' } });
  const denied = fixture('chatgpt', { getStatus: async () => ({ connected: true, planEnabled: false }) });
  await expect(prepareTeachingTrial(config, denied.bridge)).rejects.toThrow('TRIAL_CHATGPT_AUTH_REQUIRED');
});

it('rejects disconnected, wrong-provider and unready API status without ChatGPT sign-in copy', async () => {
  for (const status of [
    { teachingProvider: 'gemini', teachingConnected: false },
    { teachingProvider: 'groq', teachingConnected: true },
    { teachingProvider: 'gemini', teachingConnected: true, teachingReady: false },
  ]) {
    const { bridge, config } = fixture('gemini', { getStatus: async () => status });
    await expect(prepareTeachingTrial(config, bridge)).rejects.toThrow(/TRIAL_(CONNECTION_REQUIRED|PROVIDER_CHANGED|NOT_READY)/);
  }
});

it('waits for direct app connection when explicitly opted in', async () => {
  vi.useFakeTimers();
  const { bridge, config } = fixture('gemini');
  bridge.getStatus.mockResolvedValueOnce({ connected: false, planEnabled: false, teachingProvider: 'gemini', teachingConnected: false, teachingReady: false, model: 'first' });
  const preparation = prepareTeachingTrial({ ...config, waitForConnection: true }, bridge);
  await vi.advanceTimersByTimeAsync(500);
  await expect(preparation).resolves.toMatchObject({ providerId: 'gemini' });
});

it('bounds direct-connection waiting to five minutes without attempting inference', async () => {
  vi.useFakeTimers();
  const { bridge, config } = fixture('groq', { getStatus: vi.fn(async () => ({ teachingProvider: 'groq', teachingConnected: false })) });
  const failure = expect(prepareTeachingTrial({ ...config, waitForConnection: true }, bridge)).rejects.toThrow('TRIAL_CONNECTION_TIMEOUT');
  await vi.advanceTimersByTimeAsync(300000);
  await failure;
  expect(bridge.getModels).not.toHaveBeenCalled();
  expect(bridge.setModel).not.toHaveBeenCalled();
});

it('bounds an empty catalog to 45 seconds and refuses a changed selected model', async () => {
  vi.useFakeTimers();
  const { bridge, config } = fixture('gemini', { getModels: async () => [] });
  const failure = expect(prepareTeachingTrial(config, bridge)).rejects.toThrow('TRIAL_CATALOG_EMPTY');
  await vi.advanceTimersByTimeAsync(45000);
  await failure;
  expect(bridge.setModel).not.toHaveBeenCalled();
  const changed = fixture('gemini', { getStatus: async () => ({ teachingProvider: 'gemini', teachingConnected: true, teachingReady: true, model: 'different' }) });
  await expect(prepareTeachingTrial(changed.config, changed.bridge)).rejects.toThrow('TRIAL_MODEL_CHANGED');
  const missing = fixture('groq', { getStatus: async () => ({ teachingProvider: 'groq', teachingConnected: true, teachingReady: true }) });
  await expect(prepareTeachingTrial(missing.config, missing.bridge)).rejects.toThrow('TRIAL_MODEL_CHANGED');
});

it('diagnoses only fixed provider endpoints and allowlisted public fields', async () => {
  const network = { fetch: vi.fn(async (_url: string) => new Response(JSON.stringify({ error: { code: 'invalid_function_parameters', type: 'invalid_request_error', param: 'tools[0]', message: 'secret raw body', key: 'secret-key' } }), { status: 400 })) };
  const previous = (globalThis as any).__atlasNetworkDiagnostics;
  try {
    installLiveDiagnostics({ session: { fromPartition: () => network } });
    for (const url of ['https://api.openai.com/v1/responses', 'https://generativelanguage.googleapis.com/v1beta/interactions', 'https://api.groq.com/openai/v1/chat/completions']) await network.fetch(url);
    await network.fetch('https://api.groq.com.attacker.test/openai/v1/chat/completions');
    await network.fetch('https://api.openai.com/v11/responses');
    const diagnostics = (globalThis as any).__atlasNetworkDiagnostics;
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map((entry: any) => entry.providerId)).toEqual(['chatgpt', 'gemini', 'groq']);
    expect(diagnostics[0]).toEqual({ providerId: 'chatgpt', status: 400, code: 'invalid_function_parameters', type: 'invalid_request_error', param: 'tools[0]' });
    expect(JSON.stringify(diagnostics)).not.toMatch(/secret|schemaError|message|key/);
  } finally { (globalThis as any).__atlasNetworkDiagnostics = previous; }
});
