import {afterEach, describe, expect, it} from 'vitest';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AssetStore} from '../../apps/desktop/src/main/documents/asset-store';

const directories: string[] = [];
afterEach(async () => {await Promise.all(directories.splice(0).map(directory => rm(directory, {recursive: true, force: true})));});
async function fixture() {
  await mkdir('.test-tmp', {recursive: true});
  const directory = await mkdtemp(join(process.cwd(), '.test-tmp', 'atlas-preview-cache-')); directories.push(directory);
  const cache = join(directory, 'assets'); const store = new AssetStore(cache); await store.initialize();
  const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(10, 16); png.writeUInt32BE(10, 20);
  return {directory, cache, store, png};
}

describe('disposable document preview cache startup', () => {
  it('reclaims old generated PNGs once per store and preserves unrelated files and nested directories', async () => {
    const {directory, cache, store, png} = await fixture(); const id = await store.putPng(png);
    const unrelatedId = randomUUID(); await writeFile(join(cache, unrelatedId), 'persisted unrelated data');
    await writeFile(join(cache, 'notes.txt'), 'keep');
    const nestedId = randomUUID(); await mkdir(join(cache, nestedId)); await writeFile(join(cache, nestedId, id), png);
    await mkdir(join(directory, 'documents')); await writeFile(join(directory, 'documents', id), png);
    await store.initialize(); expect(await readdir(cache)).toContain(id);
    const reopened = new AssetStore(cache); await reopened.initialize();
    expect(await readdir(cache)).not.toContain(id);
    expect(await readFile(join(cache, unrelatedId), 'utf8')).toBe('persisted unrelated data');
    expect(await readFile(join(cache, 'notes.txt'), 'utf8')).toBe('keep');
    expect(await readFile(join(cache, nestedId, id))).toEqual(png);
    expect(await readFile(join(directory, 'documents', id))).toEqual(png);
    const next = await reopened.putPng(png); expect(await reopened.dataUrl(next)).toMatch(/^data:image\/png;base64,/);
  });
  it('bounds the number of disposable cache files removed in one startup pass', async () => {
    const {cache, png} = await fixture();
    await Promise.all(Array.from({length: 513}, () => writeFile(join(cache, randomUUID()), png)));
    await new AssetStore(cache).initialize();
    expect(await readdir(cache)).toHaveLength(1);
    await new AssetStore(cache).initialize(); expect(await readdir(cache)).toEqual([]);
  });
});
