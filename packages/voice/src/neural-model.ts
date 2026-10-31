import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import files from '../../../resources/models/kokoro-files.json';
import type { VoiceArtifact } from './contracts.js';

export const KOKORO_MODEL: VoiceArtifact = {
  id: 'kokoro-female-en', filename: 'kokoro-multi-lang-v1_0.tar.bz2', bytes: 349906910,
  sha256: 'c5f7e2d2caf082bc1d20fb70334a61d99d20b484500aad32e7cf84c128ea3298',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2',
};
export const KOKORO_DIRECTORY = 'kokoro-multi-lang-v1_0';
export const KOKORO_FILES: ReadonlyArray<{ path: string; bytes: number; sha256: string }> = files;
export async function verifyNeuralModel(directory: string): Promise<boolean> {
  try {
    const root = resolve(directory);
    for (const file of KOKORO_FILES) {
      const path = resolve(root, file.path);
      if (!path.startsWith(root + sep)) return false;
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes) return false;
      const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk);
      if (hash.digest('hex') !== file.sha256) return false;
    }
    return true;
  } catch { return false; }
}
