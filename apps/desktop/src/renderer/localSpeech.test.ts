import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSpeechPipeline, mergeTranscript, narrationPrefixAt } from './localSpeech';

const frame = (amplitude: number) => new Float32Array(1600).fill(amplitude);
const feed = (pipeline: LocalSpeechPipeline, amplitude: number, milliseconds: number) => { for (let time = 0; time < milliseconds; time += 100) pipeline.push(frame(amplitude)); };
const deferred = () => { let resolve!: (text: string) => void; const promise = new Promise<string>((done) => { resolve = done; }); return { promise, resolve }; };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('continuous local speech', () => {
  it('finalizes accepted 186ms speech after silence at the real 44.1kHz callback size', async () => {
    const transcribe = vi.fn().mockResolvedValue('Yes.');
    const onFinal = vi.fn(), onActivity = vi.fn(), onSpeechStart = vi.fn();
    const pipeline = new LocalSpeechPipeline({ sampleRate: 44100, transcribe, onDraft: vi.fn(), onFinal, onSpeechStart, onActivity, onError: vi.fn() });
    const captureFrame = (amplitude: number) => new Float32Array(4096).fill(amplitude);
    pipeline.push(captureFrame(.08)); pipeline.push(captureFrame(.08));
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    expect(onActivity).toHaveBeenLastCalledWith(true);
    for (let count = 0; count < 10; count++) pipeline.push(captureFrame(0));
    await vi.advanceTimersByTimeAsync(1);
    expect(onActivity).toHaveBeenLastCalledWith(false);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith('Yes.');
    pipeline.push(captureFrame(.08)); pipeline.push(captureFrame(.08));
    expect(onSpeechStart).toHaveBeenCalledTimes(2);
    pipeline.stop();
  });

  it('detects speech, coalesces partial work to one request, and finalizes after silence without stopping capture', async () => {
    const partial = deferred(), final = deferred();
    const transcribe = vi.fn().mockReturnValueOnce(partial.promise).mockReturnValueOnce(final.promise).mockResolvedValue('Another question');
    const onDraft = vi.fn(), onFinal = vi.fn(), onSpeechStart = vi.fn();
    const pipeline = new LocalSpeechPipeline({ sampleRate: 16000, transcribe, onDraft, onFinal, onSpeechStart, onError: vi.fn() });
    feed(pipeline, 0, 300); feed(pipeline, .08, 1200);
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(transcribe).toHaveBeenCalledTimes(1);
    feed(pipeline, .08, 1200); await vi.advanceTimersByTimeAsync(1100);
    expect(transcribe).toHaveBeenCalledTimes(1);
    partial.resolve('How does this'); await Promise.resolve(); await Promise.resolve();
    expect(onDraft).toHaveBeenCalledWith('How does this');
    feed(pipeline, 0, 1000); await vi.advanceTimersByTimeAsync(100);
    expect(transcribe).toHaveBeenCalledTimes(2);
    final.resolve('How does this work?'); await Promise.resolve(); await Promise.resolve();
    expect(onFinal).toHaveBeenCalledWith('How does this work?');
    feed(pipeline, .08, 500);
    expect(onSpeechStart).toHaveBeenCalledTimes(2);
    pipeline.stop();
  });

  it('ignores a transient click and suspends recognition during speaker playback', async () => {
    const transcribe = vi.fn().mockResolvedValue('Echo'); const onSpeechStart = vi.fn();
    const pipeline = new LocalSpeechPipeline({ sampleRate: 16000, transcribe, onDraft: vi.fn(), onFinal: vi.fn(), onSpeechStart, onError: vi.fn() });
    feed(pipeline, .2, 100); feed(pipeline, 0, 400);
    expect(onSpeechStart).not.toHaveBeenCalled();
    pipeline.setSuspended(true); feed(pipeline, .2, 3000); await vi.advanceTimersByTimeAsync(2000);
    expect(transcribe).not.toHaveBeenCalled();
    pipeline.setSuspended(false); feed(pipeline, .08, 300);
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    pipeline.stop();
  });

  it('drops late transcription results after cancellation and bounds rolling partial audio', async () => {
    const request = deferred(); const transcribe = vi.fn().mockReturnValue(request.promise); const onDraft = vi.fn(), onFinal = vi.fn();
    const pipeline = new LocalSpeechPipeline({ sampleRate: 16000, transcribe, onDraft, onFinal, onSpeechStart: vi.fn(), onError: vi.fn() });
    feed(pipeline, .1, 12000); await vi.advanceTimersByTimeAsync(1100);
    const audio = transcribe.mock.calls[0]?.[0] as ArrayBuffer;
    expect(audio.byteLength).toBeLessThanOrEqual(44 + 16000 * 8 * 2);
    pipeline.stop(); request.resolve('Must be discarded'); await Promise.resolve(); await Promise.resolve();
    expect(onDraft).not.toHaveBeenCalled(); expect(onFinal).not.toHaveBeenCalled();
  });
  it('waits for a renewed utterance to finish when recognition completes while the learner is still speaking', async () => {
    const first = deferred(); const onFinal = vi.fn();
    const transcribe = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('and a second thought.');
    const pipeline = new LocalSpeechPipeline({ sampleRate: 16000, transcribe, onDraft: vi.fn(), onFinal, onSpeechStart: vi.fn(), onError: vi.fn() });
    feed(pipeline, .1, 600); feed(pipeline, 0, 1000);
    feed(pipeline, .1, 600); first.resolve('One question,'); await Promise.resolve(); await Promise.resolve();
    expect(onFinal).not.toHaveBeenCalled();
    feed(pipeline, 0, 1000); await vi.advanceTimersByTimeAsync(20);
    expect(onFinal).toHaveBeenCalledWith('One question, and a second thought.');
    pipeline.stop();
  });
  it('splits long audio into bounded local jobs without sending a turn before silence', async () => {
    const onFinal = vi.fn(), transcribe = vi.fn().mockResolvedValueOnce('A longer explanation').mockResolvedValue('with another thought.');
    const pipeline = new LocalSpeechPipeline({ sampleRate: 16000, transcribe, onDraft: vi.fn(), onFinal, onSpeechStart: vi.fn(), onError: vi.fn() });
    feed(pipeline, .1, 29000); await vi.advanceTimersByTimeAsync(20);
    expect(onFinal).not.toHaveBeenCalled();
    feed(pipeline, 0, 1000); await vi.advanceTimersByTimeAsync(20);
    expect(onFinal).toHaveBeenCalledWith('A longer explanation with another thought.');
    for (const [audio] of transcribe.mock.calls) expect((audio as ArrayBuffer).byteLength).toBeLessThanOrEqual(44 + 16000 * 30 * 2);
    pipeline.stop();
  });
});

describe('live transcript pacing', () => {
  it('merges overlapping recognition windows without duplicating the overlap', () => {
    expect(mergeTranscript('Why does the moon appear', 'the moon appear larger near the horizon?')).toBe('Why does the moon appear larger near the horizon?');
  });
  it('reveals complete words monotonically using the audio clock, with no text before playback', () => {
    const text = 'One small idea becomes clear.';
    expect(narrationPrefixAt(text, 0, 4)).toBe('');
    const middle = narrationPrefixAt(text, 2, 4);
    expect(middle.length).toBeGreaterThan(0); expect(middle.length).toBeLessThan(text.length);
    expect(text.startsWith(middle)).toBe(true);
    expect(narrationPrefixAt(text, 4, 4)).toBe(text);
  });
});
