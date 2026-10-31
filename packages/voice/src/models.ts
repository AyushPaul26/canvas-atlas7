import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { VoiceArtifact } from './contracts.js';

const revision = '5359861c739e955e79d9a303bcbc70fb988958b1';
export const RECOGNITION_MODELS: ReadonlyArray<VoiceArtifact> = [
  { id: 'whisper-tiny-en', filename: 'ggml-tiny.en.bin', bytes: 77704715, sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f', url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${revision}/ggml-tiny.en.bin` },
  { id: 'whisper-base-en', filename: 'ggml-base.en.bin', bytes: 147964211, sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002', url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${revision}/ggml-base.en.bin` },
];
export const WHISPER_RUNTIME: VoiceArtifact = { id: 'whisper-cpp-win-x64-1.8.2', filename: 'whisper-bin-x64.zip', bytes: 3832432, sha256: 'b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732', url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip' };
export const RUNTIME_FILES: ReadonlyArray<VoiceArtifact> = [
  ['whisper-cli.exe', 481280, 'dc1648751878e91acb5cfaa69bd85cff64ede44497a108844ad9d4f106cb14e8'],
  ['whisper.dll', 483840, '4155edb6868810b56423cb0089fee85f4e8739fb86053b269f4e7c6350ec61ff'],
  ['ggml.dll', 67584, '4f681cca3014879e623b9b44f69b0864a9ddd530c32ce05c106105f4eec0897a'],
  ['ggml-base.dll', 528384, '3eefa9a256a7ef4774ec07d553ccecb771498a92000d0db7ab3443d79b795e86'],
  ['ggml-cpu.dll', 603648, '91240f9a352783312430e3b5d816621675afd2dfb9df28161bea235c4b7f1ce3'],
].map(([filename, bytes, sha256]) => ({ id: String(filename), filename: String(filename), bytes: Number(bytes), sha256: String(sha256), url: WHISPER_RUNTIME.url }));

/** No network in construction or verification. Only install() may fetch. */
export class ModelManager {
  constructor(readonly directory: string, private readonly fetcher: typeof fetch = fetch) {}
  path(artifact: VoiceArtifact) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(artifact.filename)) throw Error('Invalid model filename');
    return join(this.directory, artifact.filename);
  }
  async verify(artifact: VoiceArtifact): Promise<boolean> {
    try {
      const path = this.path(artifact); const info = await stat(path);
      if (!info.isFile() || info.size !== artifact.bytes) return false;
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      return hash.digest('hex') === artifact.sha256;
    } catch { return false; }
  }
  async install(artifact: VoiceArtifact, onProgress?: (fraction: number) => void, signal?: AbortSignal) {
    signal?.throwIfAborted();
    await mkdir(this.directory, { recursive: true });
    if (await this.verify(artifact)) { onProgress?.(1); return this.path(artifact); }
    const temporary = this.path(artifact) + `.${randomUUID()}.partial`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetcher(artifact.url, { signal, redirect: 'follow' });
      if (!response.ok || !response.body) throw Error(`Voice download failed (HTTP ${response.status})`);
      handle = await open(temporary, 'wx'); reader = response.body.getReader();
      const hash = createHash('sha256'); let received = 0;
      onProgress?.(0);
      for (;;) {
        signal?.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
        received += value.byteLength;
        if (received > artifact.bytes) throw Error('Voice download exceeds declared size');
        hash.update(value); await handle.writeFile(value);
        onProgress?.(Math.min(0.999, received / artifact.bytes));
      }
      signal?.throwIfAborted();
      if (received !== artifact.bytes || hash.digest('hex') !== artifact.sha256) throw Error('Voice download SHA-256 or size mismatch');
      await handle.sync(); await handle.close(); handle = undefined;
      await rename(temporary, this.path(artifact)); onProgress?.(1);
      return this.path(artifact);
    } finally {
      await reader?.cancel().catch(() => {}); await handle?.close(); await rm(temporary, { force: true });
    }
  }
}
