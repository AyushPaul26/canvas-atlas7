import type { AudioSegment } from './contracts.js';

/** Decode RIFF chunks, never assume SAPI writes a fixed 44-byte header. */
export function decodePcmWav(input: Uint8Array): AudioSegment {
  if (input.byteLength < 44 || input.byteLength > 32 * 1024 * 1024) throw Error('Invalid WAV size');
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw Error('Expected RIFF WAV');
  if (b.readUInt32LE(4) + 8 !== b.length) throw Error('Truncated WAV');
  let channels = 0; let rate = 0; let bits = 0; let format = 0; let data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= b.length;) {
    const kind = b.toString('ascii', offset, offset + 4); const size = b.readUInt32LE(offset + 4); const start = offset + 8;
    if (start + size > b.length) throw Error('Truncated WAV chunk');
    if (kind === 'fmt ') {
      if (size < 16) throw Error('Invalid WAV format');
      format = b.readUInt16LE(start); channels = b.readUInt16LE(start + 2); rate = b.readUInt32LE(start + 4); bits = b.readUInt16LE(start + 14);
    } else if (kind === 'data') data = b.subarray(start, start + size);
    offset = start + size + (size & 1);
  }
  if (format !== 1 || channels !== 1 || bits !== 16 || !data || data.length % 2 || rate < 8000 || rate > 48000) throw Error('Expected mono signed 16-bit PCM WAV');
  const samples = new Float32Array(data.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
  return { samples, sampleRate: rate };
}
export function validateRecognitionWav(input: Uint8Array) {
  if (input.byteLength > 960_128) throw Error('Microphone audio exceeds 30 seconds');
  const audio = decodePcmWav(input);
  if (audio.sampleRate !== 16000) throw Error('Recognition requires 16000 Hz mono WAV');
  if (audio.samples.length < 160 || audio.samples.length > 480000) throw Error('Audio must last 0.01 to 30 seconds');
  return audio;
}
