import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { ApiProviderId, ProviderId, TeachingConfiguration } from '@living-canvas/protocol';
import { bridge } from '../bridge';
import './teaching-settings.css';

const names: Record<ProviderId, string> = { chatgpt: 'ChatGPT', gemini: 'Gemini', groq: 'Groq' };
type Props = { desktop: boolean; revision?: number; beforeChange: () => Promise<void>; onChange: (configuration: TeachingConfiguration) => Promise<void> };

export default function TeachingSettings({ desktop, revision, beforeChange, onChange }: Props) {
  const [configuration, setConfiguration] = useState<TeachingConfiguration | null>(null);
  const [keys, setKeys] = useState({ gemini: '', groq: '' });
  const [visible, setVisible] = useState({ gemini: false, groq: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const mounted = useRef(false), generation = useRef(0), pending = useRef(false);
  const available = desktop && typeof bridge.getTeachingConfiguration === 'function';
  useEffect(() => {
    mounted.current = true;
    const request = ++generation.current;
    if (!available) { setLoading(false); return; }
    setLoading(true);
    void bridge.getTeachingConfiguration().then(value => {
      if (mounted.current && request === generation.current) setConfiguration(value);
    }).catch(() => { if (mounted.current && request === generation.current) setError('Teaching connections could not be loaded. Close Settings and try again.'); })
      .finally(() => { if (mounted.current && request === generation.current) setLoading(false); });
    return () => { mounted.current = false; generation.current++; };
  }, [available, revision]);

  if (!available) return null;
  const perform = async (operation: () => Promise<TeachingConfiguration>, message: string, { secret, checkpoint = true }: { secret?: string; checkpoint?: boolean } = {}) => {
    if (pending.current) return;
    pending.current = true; generation.current++; setBusy(true); setLoading(false); setError(undefined); setNotice(undefined);
    try {
      if (checkpoint) await beforeChange();
      if (!mounted.current) return;
      const value = await operation();
      if (!mounted.current) return;
      setConfiguration(value); await onChange(value);
      if (mounted.current) setNotice(message);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : 'Teaching settings could not be updated. Try again.';
      if (mounted.current) setError(secret ? text.split(secret).join('[hidden]') : text);
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const connect = (providerId: ApiProviderId) => {
    if (pending.current) return;
    const key = keys[providerId].trim();
    if (!key) return;
    setKeys(value => ({ ...value, [providerId]: '' })); setVisible(value => ({ ...value, [providerId]: false }));
    void perform(() => bridge.connectTeachingKey({ providerId, key }), `${names[providerId]} selected for your next teaching request.`, { secret: key });
  };
  const active = configuration?.connections.find(connection => connection.providerId === configuration.activeProvider);
  const disabled = loading || busy || !configuration;
  return <section className="settings-section teaching-settings" aria-label="Teaching connections" aria-busy={loading || busy}>
    <div className="settings-section-heading"><span className="settings-icon"><Sparkles size={20} /></span><div><h3>Teaching intelligence</h3><p>Connect Gemini or Groq to use it for your next lesson. Voice settings stay separate.</p></div></div>
    {loading && <p className="small-copy" role="status">Loading teaching connections…</p>}
    {configuration && <><label className="field-label" htmlFor="teaching-provider">Teaching provider</label><select id="teaching-provider" value={configuration.activeProvider} disabled={disabled} onChange={event => { const providerId = event.target.value as ProviderId; void perform(() => bridge.selectTeachingProvider({ providerId }), `${names[providerId]} selected for your next teaching request.`); }}>{configuration.connections.map(connection => <option key={connection.providerId} value={connection.providerId} disabled={connection.providerId !== 'chatgpt' && !connection.hasKey}>{names[connection.providerId]}</option>)}</select>
      {active && active.providerId !== 'chatgpt' && <div className="teaching-active-model"><div className="settings-status-row"><span>Active service</span><span className="status-label">{names[active.providerId]}</span></div><label className="field-label" htmlFor="api-teaching-model">Teaching model</label><select id="api-teaching-model" value={active.model ?? ''} disabled={disabled || !active.connected || !active.models.length} onChange={event => { const providerId = active.providerId, modelId = event.target.value; void perform(() => bridge.selectTeachingProvider({ providerId, modelId }), 'Teaching model updated.'); }}>
        {active.model && !active.models.some(model => model.id === active.model) && <option value={active.model} disabled>{active.model} · unavailable</option>}
        {!active.model && <option value="" disabled>{active.models.length ? 'Choose a teaching model' : 'No models available'}</option>}{active.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>{!active.modelAvailable && <p className="inline-error">Your selected model is unavailable. Refresh models or choose an available teaching model.</p>}{active.error && <p className="inline-error" role="alert">{active.error}</p>}<button type="button" className="text-button" disabled={disabled || !active.hasKey} onClick={() => void perform(() => bridge.refreshTeachingModels(active.providerId), 'Teaching models refreshed.', { checkpoint: false })}>Refresh models</button></div>}
    </>}
    {(['gemini', 'groq'] as const).map(providerId => { const saved = configuration?.connections.find(connection => connection.providerId === providerId)?.hasKey; return <form noValidate key={providerId} className="teaching-key-form" onSubmit={event => { event.preventDefault(); connect(providerId); }}><label className="field-label" htmlFor={`${providerId}-api-key`}>{names[providerId]} API key</label><div className="teaching-key-input"><input id={`${providerId}-api-key`} type={visible[providerId] ? 'text' : 'password'} value={keys[providerId]} autoComplete="off" spellCheck={false} disabled={disabled} placeholder={saved ? 'A key is saved securely' : 'Paste your API key'} onChange={event => setKeys(value => ({ ...value, [providerId]: event.target.value }))} onKeyDown={event => { if (event.nativeEvent.isComposing && event.key === 'Enter') event.preventDefault(); }} /><button type="button" className="text-button" disabled={disabled || !keys[providerId]} aria-label={`${visible[providerId] ? 'Hide' : 'Show'} ${names[providerId]} API key`} aria-pressed={visible[providerId]} onClick={() => setVisible(value => ({ ...value, [providerId]: !value[providerId] }))}>{visible[providerId] ? 'Hide' : 'Show'}</button></div><div className="teaching-key-actions"><button type="submit" className="button secondary compact" disabled={disabled || !keys[providerId].trim()}>{saved ? 'Replace' : 'Connect'} {names[providerId]}</button>{saved && <button type="button" className="text-button" disabled={disabled} onClick={() => void perform(() => bridge.clearTeachingKey(providerId), `${names[providerId]} API key removed.`, { checkpoint: configuration?.activeProvider === providerId })}>Remove {names[providerId]} key</button>}</div></form>; })}
    {error && <p className="inline-error" role="alert">{error}</p>}{notice && <p className="small-copy" role="status">{notice}</p>}<p className="settings-footnote">API keys are protected on this device. Teaching sends your lesson content to the selected service. A valid key and model do not guarantee available quota.</p>
  </section>;
}
