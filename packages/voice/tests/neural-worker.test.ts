import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NeuralTtsWorker } from '../../../apps/desktop/src/main/voice/neural-tts.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const clean of cleanups.splice(0)) await clean(); });
async function worker(script?: string) {
  const base = join(process.cwd(), '.test-tmp', 'voice-worker-tests'); await mkdir(base, { recursive: true }); const directory = await mkdtemp(join(base, 'test-'));
  const path = join(directory, 'worker.cjs');
  await writeFile(path, script ?? `const readline=require('node:readline');let n=0;console.log(JSON.stringify({type:'ready',sampleRate:24000}));readline.createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);const samples=Float32Array.from([++n/10,0.2,0.1]);setTimeout(()=>console.log(JSON.stringify({type:'audio',id:q.id,sampleRate:24000,samples:Buffer.from(samples.buffer).toString('base64')})),q.text==='slow'?1000:0)});`);
  const result = new NeuralTtsWorker({ workerPath: path, addonPath: 'unused', modelDirectory: directory });
  cleanups.push(async () => { result.dispose(); await new Promise(resolve => setTimeout(resolve, 30)); await rm(directory, { recursive: true, force: true }); }); return result;
}
describe('resident local neural voice worker', () => {
  it('loads once and returns bounded 24kHz PCM for fresh text on repeated requests', async () => {
    const voice = await worker(); await voice.prepare();
    const one = await voice.synthesize('First sentence'); const two = await voice.synthesize('Second sentence');
    expect(one.sampleRate).toBe(24000); expect(one.samples[0]).toBeCloseTo(0.1); expect(two.samples[0]).toBeCloseTo(0.2);
  });
  it('kills canceled inference, rejects stale audio and restarts for the next request', async () => {
    const voice = await worker(); await voice.prepare(); const controller = new AbortController();
    const pending = voice.synthesize('slow', controller.signal); controller.abort(); await expect(pending).rejects.toThrow(/cancel|abort/i);
    expect((await voice.synthesize('New turn')).samples[0]).toBeCloseTo(0.1);
  });
  it('rejects invalid audio metadata and worker death', async () => {
    const invalid = await worker(`console.log(JSON.stringify({type:'ready',sampleRate:24000}));process.stdin.once('data',()=>console.log(JSON.stringify({type:'audio',id:1,sampleRate:0,samples:'AAAA'})));`);
    await expect(invalid.synthesize('Hello')).rejects.toThrow(/audio|PCM|rate/i);
    const dead = await worker('process.exit(3)'); await expect(dead.prepare()).rejects.toThrow(/worker|3/i);
  });
  it('rejects oversized text before starting inference', async () => { const voice = await worker(); await expect(voice.synthesize('x'.repeat(601))).rejects.toThrow(/600/); });
  it('uses copied native buffers compatible with the Electron memory cage', async () => {
    const base = join(process.cwd(), '.test-tmp', 'voice-worker-tests'); await mkdir(base, { recursive: true }); const directory = await mkdtemp(join(base, 'electron-'));
    const addon = join(directory, 'addon.cjs'); await writeFile(addon, `module.exports={OfflineTts:class{generate(request){if(request.enableExternalBuffer!==false)throw Error('External buffers are not allowed');return{sampleRate:24000,samples:Float32Array.from([0.1,0.2])}}},GenerationConfig:class{}};`);
    const voice = new NeuralTtsWorker({ workerPath: join(process.cwd(), 'resources', 'voice', 'kokoro-worker.cjs'), addonPath: addon, modelDirectory: directory });
    cleanups.push(async () => { voice.dispose(); await new Promise(resolve => setTimeout(resolve, 30)); await rm(directory, { recursive: true, force: true }); });
    expect((await voice.synthesize('A neural sentence')).samples[0]).toBeCloseTo(0.1);
  });
});
