import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AudioSegment } from '../../../../../packages/voice/src/contracts.js';

interface Options { workerPath: string; addonPath: string; modelDirectory: string; threads?: number }
interface Pending { id: number; resolve: (audio: AudioSegment) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; signal?: AbortSignal; abort: () => void }
/** Native ONNX inference and model loading live only in this resident, killable child. */
export class NeuralTtsWorker {
  private child?: ChildProcessWithoutNullStreams;
  private boot?: Promise<void>;
  private rejectBoot?: (error: Error) => void;
  private bootTimer?: ReturnType<typeof setTimeout>;
  private pending?: Pending;
  private nextId = 0;
  private disposed = false;
  constructor(private options: Options) {}
  prepare(): Promise<void> {
    if (this.disposed) return Promise.reject(Error('Neural voice worker is disposed'));
    if (this.boot) return this.boot;
    const child = spawn(process.execPath, [this.options.workerPath, this.options.addonPath, this.options.modelDirectory, String(this.options.threads ?? 2)], { windowsHide: true, shell: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.boot = new Promise<void>((resolve, reject) => {
      this.rejectBoot = reject;
      this.bootTimer = setTimeout(() => this.reset(Error('Neural voice model startup timed out')), 60000);
      let buffered = ''; let diagnostic = '';
      child.stdout.on('data', (chunk: Buffer) => {
        if (this.child !== child) return;
        buffered += chunk.toString('utf8');
        if (buffered.length > 8 * 1024 * 1024) { this.reset(Error('Neural voice worker output limit exceeded')); return; }
        let newline: number;
        while ((newline = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line) as { type: string; id?: number; sampleRate?: number; samples?: string; error?: string };
            if (message.type === 'ready') { clearTimeout(this.bootTimer); this.bootTimer = undefined; this.rejectBoot = undefined; resolve(); }
            else if (message.type === 'error') this.reset(Error(`Neural voice: ${(message.error ?? 'inference failed').slice(0, 500)}`));
            else if (message.type === 'audio' && this.pending?.id === message.id) {
              if (message.sampleRate !== 24000 || typeof message.samples !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.samples)) throw Error('Invalid neural PCM audio metadata');
              const bytes = Buffer.from(message.samples, 'base64');
              if (!bytes.length || bytes.length % 4 || bytes.length > 6 * 1024 * 1024) throw Error('Invalid neural PCM audio size');
              const samples = new Float32Array(bytes.length / 4); new Uint8Array(samples.buffer).set(bytes);
              if (!samples.every(Number.isFinite)) throw Error('Neural PCM contains invalid samples');
              const pending = this.pending!; this.pending = undefined; clearTimeout(pending.timer); pending.signal?.removeEventListener('abort', pending.abort); pending.resolve({ samples, sampleRate: 24000 });
            } else throw Error('Unexpected neural voice worker message');
          } catch (error) { this.reset(error instanceof Error ? error : Error('Invalid neural voice response')); return; }
        }
      });
      child.stderr.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString('utf8')).slice(-2000); });
      child.on('error', error => { if (this.child === child) this.reset(error); });
      child.on('close', code => { if (this.child === child) this.reset(Error(`Neural voice worker exited (${code}): ${diagnostic.slice(-500)}`)); });
      child.stdin.on('error', () => {});
    });
    return this.boot;
  }
  async synthesize(text: string, signal?: AbortSignal): Promise<AudioSegment> {
    if (!text.trim() || text.length > 600) throw Error('Neural voice segment must contain 1 to 600 characters');
    signal?.throwIfAborted();
    const abortStartup = () => this.reset(Error('Neural voice job canceled'));
    signal?.addEventListener('abort', abortStartup, { once: true });
    try { await this.prepare(); } finally { signal?.removeEventListener('abort', abortStartup); }
    signal?.throwIfAborted();
    if (this.pending) throw Error('Neural voice worker is busy');
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const abort = () => this.reset(Error('Neural voice job canceled'));
      const timer = setTimeout(() => this.reset(Error('Neural voice synthesis timed out')), 60000);
      this.pending = { id, resolve, reject, timer, signal, abort };
      signal?.addEventListener('abort', abort, { once: true });
      this.child!.stdin.write(JSON.stringify({ id, text }) + '\n');
    });
  }
  private reset(error: Error) {
    const child = this.child; this.child = undefined; this.boot = undefined;
    clearTimeout(this.bootTimer); this.bootTimer = undefined; this.rejectBoot?.(error); this.rejectBoot = undefined;
    const pending = this.pending; this.pending = undefined;
    if (pending) { clearTimeout(pending.timer); pending.signal?.removeEventListener('abort', pending.abort); pending.reject(error); }
    child?.kill();
  }
  cancel() { if (this.pending) this.reset(Error('Neural voice job canceled')); }
  dispose() { this.disposed = true; this.reset(Error('Neural voice worker disposed')); }
}
