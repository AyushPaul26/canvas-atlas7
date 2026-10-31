// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ transcribe: vi.fn(), synthesize: vi.fn() }));
vi.mock('./bridge', () => ({ bridge: { voiceStatus: async () => ({ recognitionReady: true, synthesisReady: true }), onVoiceProgress: () => () => {}, transcribeAudio: io.transcribe, synthesizeSpeech: io.synthesize, installVoiceModel: vi.fn() } }));
import { useVoice } from './useVoice';

let processor: { onaudioprocess?: (event: unknown) => void };
const stopTrack = vi.fn();
class TestAudioContext {
  sampleRate = 16000; state = 'running'; destination = {}; onstatechange?: () => void;
  startedAt = Date.now();
  get currentTime() { return (Date.now() - this.startedAt) / 1000; }
  resume = async () => {};
  close = async () => { this.state = 'closed'; this.onstatechange?.(); };
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { const node = { connect() {}, disconnect() {}, onaudioprocess: undefined }; processor = node; return node; }
  createBuffer(_channels: number, length: number, rate: number) { return { duration: length / rate, copyToChannel() {} }; }
  createBufferSource() { return { buffer: null as { duration: number } | null, playbackRate: { value: 1 }, onended: () => {}, connect() {}, start() { setTimeout(() => this.onended(), this.buffer!.duration * 1000 / this.playbackRate.value); } }; }
}
const push = (amplitude: number, milliseconds: number) => { for (let i = 0; i < milliseconds; i += 100) processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(1600).fill(amplitude) } }); };

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers(); stopTrack.mockReset(); io.transcribe.mockReset().mockResolvedValue('A spoken question'); io.synthesize.mockReset().mockResolvedValue({ samples: new Float32Array(40000), sampleRate: 8000 });
  vi.stubGlobal('AudioContext', TestAudioContext);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) } });
});

it('persists a bounded voice-speed preference and restores it for the next hook instance', async () => {
  const first = renderHook(() => useVoice(vi.fn(), vi.fn()));
  expect(first.result.current.rate).toBe(.96);
  act(() => first.result.current.setRate(2)); expect(first.result.current.rate).toBe(1.25);
  expect(localStorage.getItem('canvas-atlas-voice-speed')).toBe('1.25');
  first.unmount();
  const second = renderHook(() => useVoice(vi.fn(), vi.fn()));
  expect(second.result.current.rate).toBe(1.25);
  act(() => second.result.current.setRate(.1)); expect(second.result.current.rate).toBe(.75);
});

it('keeps voice speed usable when preference storage throws', async () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled'); });
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disabled'); });
  try {
    const { result } = renderHook(() => useVoice(vi.fn(), vi.fn()));
    expect(result.current.rate).toBe(.96);
    act(() => result.current.setRate(1.1)); expect(result.current.rate).toBe(1.1);
  } finally { get.mockRestore(); set.mockRestore(); }
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('continuous microphone and audio clock', () => {
  it('shows live drafts and automatically submits after silence while keeping the same microphone open', async () => {
    const onFinal = vi.fn(), onDraft = vi.fn();
    const { result } = renderHook(() => useVoice(vi.fn(), vi.fn(), { onFinal, onDraft }));
    await act(async () => { await result.current.startRecording(); });
    act(() => push(.1, 1200)); await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(onDraft).toHaveBeenCalledWith('A spoken question'); expect(onFinal).not.toHaveBeenCalled();
    act(() => push(0, 1000)); await act(() => vi.advanceTimersByTimeAsync(100));
    expect(onFinal).toHaveBeenCalledWith('A spoken question');
    expect(result.current.recording).toBe(true); expect(stopTrack).not.toHaveBeenCalled();
    await act(() => result.current.stopRecording(true)); expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it('shows teacher words during PCM playback while persisting only completed spoken chunks', async () => {
    const heard = vi.fn(), displayed = vi.fn();
    const { result } = renderHook(() => useVoice(vi.fn(), vi.fn()));
    let playback!: ReturnType<typeof result.current.speak>;
    act(() => { playback = result.current.speak('Hello there learner.', heard, displayed); });
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(displayed).toHaveBeenCalled(); expect(displayed.mock.calls.at(-1)?.[0].length).toBeGreaterThan(0);
    expect(heard).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); await playback; });
    expect(heard).toHaveBeenLastCalledWith('Hello there learner.');
  });

  it('gates speaker echo during playback and resumes voice activity afterwards', async () => {
    const onset = vi.fn(); const { result } = renderHook(() => useVoice(vi.fn(), vi.fn(), { onSpeechStart: onset }));
    await act(() => result.current.startRecording());
    act(() => { void result.current.speak('Hello there learner.'); });
    await act(() => vi.advanceTimersByTimeAsync(100));
    act(() => push(.2, 2000)); await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(onset).not.toHaveBeenCalled(); expect(io.transcribe).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    act(() => push(.1, 400));
    expect(onset).toHaveBeenCalledTimes(1);
  });
  it('prepares only one next segment while the current PCM segment plays', async () => {
    let finishSecond!: (audio: { samples: Float32Array; sampleRate: number }) => void;
    io.synthesize.mockReset().mockResolvedValueOnce({ samples: new Float32Array(40000), sampleRate: 8000 }).mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve; })).mockResolvedValue({ samples: new Float32Array(40000), sampleRate: 8000 });
    const { result } = renderHook(() => useVoice(vi.fn(), vi.fn()));
    act(() => { void result.current.speak('First short sentence. Second short sentence. Third short sentence.'); });
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(io.synthesize).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(5400));
    expect(io.synthesize).toHaveBeenCalledTimes(2);
    await act(async () => { finishSecond({ samples: new Float32Array(40000), sampleRate: 8000 }); await Promise.resolve(); });
    expect(io.synthesize).toHaveBeenCalledTimes(3);
    act(() => result.current.stopSpeaking());
  });
});

it('reports unavailable playback for disabled voice without claiming heard narration', async () => {
  const heard = vi.fn();
  const { result } = renderHook(() => useVoice(vi.fn(), vi.fn()));
  act(() => result.current.toggle());
  let outcome: unknown;
  await act(async () => { outcome = await result.current.speak('This is not heard.', heard); });
  expect(outcome).toBe('unavailable');
  expect(heard).not.toHaveBeenCalled();
});

it('reports synthesis failures instead of resolving as successful speech', async () => {
  io.synthesize.mockRejectedValue(new Error('speaker unavailable'));
  const heard = vi.fn();
  const { result } = renderHook(() => useVoice(vi.fn(), vi.fn()));
  let outcome: unknown;
  await act(async () => { outcome = await result.current.speak('Hear this.', heard); });
  expect(outcome).toBe('failed');
  expect(heard).not.toHaveBeenCalled();
});
