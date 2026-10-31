// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { encodeWave } from './useVoice';

describe('local recording format', () => {
  it('encodes 48kHz browser PCM as bounded mono 16kHz signed16 WAV', () => {
    const samples = new Float32Array(48000).fill(.5);
    const view = new DataView(encodeWave([samples], 48000));
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(32000);
    expect(view.getInt16(44, true)).toBe(16384);
  });
  it('clips invalid amplitude and caps recordings at 30 seconds', () => {
    const samples = new Float32Array(16000 * 32).fill(2);
    const view = new DataView(encodeWave([samples], 16000));
    expect(view.byteLength).toBe(44 + 16000 * 30 * 2);
    expect(view.getInt16(44, true)).toBe(32767);
  });
});
