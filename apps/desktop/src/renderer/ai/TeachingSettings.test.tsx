// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderId, TeachingConfiguration } from '@living-canvas/protocol';
const fixture = vi.hoisted(() => ({ bridge: { getTeachingConfiguration: vi.fn(), refreshTeachingModels: vi.fn(), selectTeachingProvider: vi.fn(), connectTeachingKey: vi.fn(), clearTeachingKey: vi.fn() } }));
vi.mock('../bridge', () => ({ bridge: fixture.bridge }));
import TeachingSettings from './TeachingSettings';

function configuration(activeProvider: ProviderId = 'chatgpt'): TeachingConfiguration {
  return { activeProvider, revision: 1, connections: (['chatgpt', 'gemini', 'groq'] as const).map(providerId => ({ providerId, connected: providerId === 'chatgpt' || providerId === activeProvider, hasKey: providerId === activeProvider && providerId !== 'chatgpt', model: `${providerId}-remembered`, modelAvailable: true, models: [{ id: `${providerId}-remembered`, name: `${providerId} remembered model` }, { id: `${providerId}-other`, name: `${providerId} other model` }] })) };
}
beforeEach(() => { vi.resetAllMocks(); fixture.bridge.getTeachingConfiguration.mockResolvedValue(configuration()); });
afterEach(cleanup);

describe('teaching connections', () => {
  it('keeps active teaching running when refreshing models or removing an inactive saved key', async () => {
    const saved = configuration('gemini'); saved.connections[2].hasKey = true;
    fixture.bridge.getTeachingConfiguration.mockResolvedValue(saved);
    fixture.bridge.refreshTeachingModels.mockResolvedValue(saved);
    const removed = structuredClone(saved); removed.connections[2].hasKey = false;
    fixture.bridge.clearTeachingKey.mockResolvedValue(removed);
    const beforeChange = vi.fn(async () => {}), onChange = vi.fn(async () => {});
    render(<TeachingSettings desktop beforeChange={beforeChange} onChange={onChange} />);
    await screen.findByLabelText('Teaching provider');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await screen.findByText('Teaching models refreshed.');
    expect(beforeChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Groq key' }));
    await screen.findByText('Groq API key removed.');
    expect(beforeChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Teaching provider') as HTMLSelectElement).value).toBe('gemini');
    expect((screen.getByLabelText('Teaching model') as HTMLSelectElement).value).toBe('gemini-remembered');
  });

  it.each(['gemini', 'groq'] as const)('clears and masks the %s key immediately, checkpoints before connecting, and automatically selects its returned model', async providerId => {
    let finishPause!: () => void;
    const beforeChange = vi.fn(() => new Promise<void>(resolve => { finishPause = resolve; })), onChange = vi.fn(async () => {});
    fixture.bridge.connectTeachingKey.mockResolvedValue(configuration(providerId));
    render(<TeachingSettings desktop beforeChange={beforeChange} onChange={onChange} />);
    await screen.findByLabelText('Teaching provider');
    const name = providerId === 'gemini' ? 'Gemini' : 'Groq';
    const input = screen.getByLabelText(`${name} API key`) as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'test-only-input' } });
    expect(beforeChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: `Show ${name} API key` }));
    expect(input.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: `Connect ${name}` }));
    expect(input.value).toBe(''); expect(input.type).toBe('password');
    expect(fixture.bridge.connectTeachingKey).not.toHaveBeenCalled();
    await act(async () => { finishPause(); });
    await screen.findByRole('button', { name: `Replace ${name}` });
    expect((screen.getByLabelText('Teaching provider') as HTMLSelectElement).value).toBe(providerId);
    expect((screen.getByLabelText('Teaching model') as HTMLSelectElement).value).toBe(`${providerId}-remembered`);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ activeProvider: providerId }));
    expect(fixture.bridge.selectTeachingProvider).not.toHaveBeenCalled();
  });

  it('keeps a failed replacement on its saved provider and removes the submitted secret from errors', async () => {
    fixture.bridge.getTeachingConfiguration.mockResolvedValue(configuration('gemini'));
    fixture.bridge.connectTeachingKey.mockRejectedValue(new Error('Key test-only-input was rejected. Check your API key.'));
    render(<TeachingSettings desktop beforeChange={async () => {}} onChange={async () => {}} />);
    await screen.findByLabelText('Teaching provider');
    fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'test-only-input' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace Gemini' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Check your API key');
    expect(screen.getByRole('alert').textContent).not.toContain('test-only-input');
    expect((screen.getByLabelText('Teaching provider') as HTMLSelectElement).value).toBe('gemini');
    expect((screen.getByLabelText('Gemini API key') as HTMLInputElement).value).toBe('');
  });

  it('restores saved provider and model choices, pauses model switching, refreshes and removes a saved key', async () => {
    const saved = configuration('groq'); saved.connections[1].hasKey = true;
    fixture.bridge.getTeachingConfiguration.mockResolvedValue(saved);
    fixture.bridge.selectTeachingProvider.mockResolvedValue(configuration('gemini'));
    fixture.bridge.refreshTeachingModels.mockResolvedValue(configuration('gemini'));
    const removed = configuration('gemini'); Object.assign(removed.connections[1], { hasKey: false, connected: false, models: [], modelAvailable: false });
    fixture.bridge.clearTeachingKey.mockResolvedValue(removed);
    const beforeChange = vi.fn(async () => {});
    render(<TeachingSettings desktop beforeChange={beforeChange} onChange={async () => {}} />);
    await screen.findByLabelText('Teaching provider');
    expect((screen.getByLabelText('Teaching model') as HTMLSelectElement).value).toBe('groq-remembered');
    fireEvent.change(screen.getByLabelText('Teaching provider'), { target: { value: 'gemini' } });
    await waitFor(() => expect((screen.getByLabelText('Teaching model') as HTMLSelectElement).value).toBe('gemini-remembered'));
    expect(beforeChange.mock.invocationCallOrder[0]).toBeLessThan(fixture.bridge.selectTeachingProvider.mock.invocationCallOrder[0]);
    fireEvent.change(screen.getByLabelText('Teaching model'), { target: { value: 'gemini-other' } });
    await waitFor(() => expect(fixture.bridge.selectTeachingProvider).toHaveBeenLastCalledWith({ providerId: 'gemini', modelId: 'gemini-other' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh models' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await waitFor(() => expect(fixture.bridge.refreshTeachingModels).toHaveBeenCalledWith('gemini'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Remove Gemini key' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Gemini key' }));
    await screen.findByRole('button', { name: 'Connect Gemini' });
    expect((screen.getByLabelText('Teaching model') as HTMLSelectElement).value).toBe('gemini-remembered');
    expect(screen.getByText(/Your selected model is unavailable/)).toBeTruthy();
  });

  it('keeps unavailable remembered model IDs visible and reports the active catalog error', async () => {
    const saved = configuration('groq'); saved.connections[2].models = []; saved.connections[2].modelAvailable = false; saved.connections[2].error = 'Groq model list could not load. Refresh models to retry.';
    fixture.bridge.getTeachingConfiguration.mockResolvedValue(saved);
    render(<TeachingSettings desktop beforeChange={async () => {}} onChange={async () => {}} />);
    await screen.findByLabelText('Teaching provider');
    expect((screen.getByLabelText('Teaching model') as HTMLSelectElement).value).toBe('groq-remembered');
    expect(screen.getByRole('option', { name: 'groq-remembered · unavailable' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Groq model list could not load');
  });
});
