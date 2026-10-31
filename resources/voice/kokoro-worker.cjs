/* global require, process, Buffer */
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS child must run outside the app's ESM/ASAR bundle. */
// Trusted local helper. No network API is used. Student text is data on a bounded JSON pipe.
const { join } = require('node:path');
const readline = require('node:readline');
try {
  const sherpa = require(process.argv[2]);
  const directory = process.argv[3];
  const threads = Math.max(1, Math.min(4, Number(process.argv[4]) || 2));
  const tts = new sherpa.OfflineTts({
    model: { kokoro: { model: join(directory, 'model.onnx'), voices: join(directory, 'voices.bin'), tokens: join(directory, 'tokens.txt'), lexicon: join(directory, 'lexicon-us-en.txt'), dataDir: join(directory, 'espeak-ng-data') }, numThreads: threads, provider: 'cpu', debug: false },
    maxNumSentences: 1,
  });
  // Official v1.0 mapping: speaker ID 3 is American female af_heart.
  const generationConfig = new sherpa.GenerationConfig({ sid: 3, speed: 1.0, silenceScale: 0.2 });
  process.stdout.write(JSON.stringify({ type: 'ready', sampleRate: 24000, voice: 'af_heart' }) + '\n');
  let bufferedBytes = 0;
  process.stdin.on('data', chunk => { bufferedBytes += chunk.length; if (bufferedBytes > 12000) process.exit(2); });
  readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
    bufferedBytes = 0;
    try {
      if (line.length > 6000) throw Error('Neural request is too large');
      const request = JSON.parse(line);
      if (!Number.isInteger(request.id) || typeof request.text !== 'string' || !request.text.trim() || request.text.length > 600) throw Error('Invalid neural voice request');
      const audio = tts.generate({ text: request.text, generationConfig, enableExternalBuffer: false });
      if (audio.sampleRate !== 24000 || audio.samples.length > 1500000) throw Error('Neural audio exceeds the segment limit');
      const samples = Buffer.from(audio.samples.buffer, audio.samples.byteOffset, audio.samples.byteLength).toString('base64');
      process.stdout.write(JSON.stringify({ type: 'audio', id: request.id, sampleRate: audio.sampleRate, samples }) + '\n');
    } catch (error) { process.stdout.write(JSON.stringify({ type: 'error', error: String(error.message || error) }) + '\n'); }
  });
} catch (error) { process.stdout.write(JSON.stringify({ type: 'error', error: String(error.message || error) }) + '\n'); process.exitCode = 1; }
