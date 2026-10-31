import {randomUUID} from 'node:crypto';
import {lstat, mkdir, open, opendir, readFile, unlink, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';

const idPattern = /^[a-f0-9-]{36}$/;
const generatedIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export class AssetStore {
  private initialization?: Promise<void>;
  constructor(private readonly directory: string) {}
  initialize(): Promise<void> {return this.initialization ??= this.prepare();}
  private async prepare() {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    const directoryInfo = await lstat(this.directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw Error('Preview cache must be a local directory');
    // These generated PNGs have no persisted references: document manifests and
    // sections point to originals; page-to-preview IDs exist only in memory.
    // Reclaim a bounded flat batch, never recurse or touch unknown cache entries.
    let inspected = 0; let removed = 0;
    for await (const entry of await opendir(this.directory)) {
      if (++inspected > 4096 || removed >= 512) break;
      if (!entry.isFile() || !generatedIdPattern.test(entry.name)) continue;
      const path = join(this.directory, entry.name);
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size < 8 || info.size > 2 * 1024 * 1024) continue;
        const handle = await open(path, 'r');
        let recognized = false;
        try {
          const header = Buffer.alloc(8); const {bytesRead} = await handle.read(header, 0, header.length, 0);
          recognized = bytesRead === 8 && header.equals(pngSignature);
        } finally {await handle.close();}
        // unlink removes only this direct entry, including if it was replaced by
        // a link while inspected; it never follows a link into another directory.
        if (recognized) {await unlink(path); removed++;}
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
  }
  async putPng(bytes: Uint8Array): Promise<string> {
    if (bytes.byteLength > 2 * 1024 * 1024 || bytes.byteLength < 24 || !Buffer.from(bytes.subarray(0, 8)).equals(pngSignature)) throw Error('Invalid or oversized page preview');
    const buffer = Buffer.from(bytes); const width = buffer.readUInt32BE(16); const height = buffer.readUInt32BE(20);
    if (!width || !height || width > 1600 || height > 1600) throw Error('Invalid page preview dimensions');
    const id = randomUUID(); await writeFile(join(this.directory, id), buffer, {mode: 0o600, flag: 'wx'}); return id;
  }
  async dataUrl(id: string): Promise<string> {
    if (!idPattern.test(id)) throw Error('Invalid asset ID');
    const bytes = await readFile(join(this.directory, id));
    if (bytes.length > 2 * 1024 * 1024) throw Error('Oversized page preview');
    return `data:image/png;base64,${bytes.toString('base64')}`;
  }
  async remove(id: string) {if (!idPattern.test(id)) throw Error('Invalid asset ID'); await rm(join(this.directory, id), {force: true});}
}
