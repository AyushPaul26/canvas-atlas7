import {afterEach, describe, expect, it} from 'vitest';
import {mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DocumentService} from '../../apps/desktop/src/main/documents/document-service';
import {extractPdf, renderPdfPage} from '../../apps/document-host/src/worker';
import type {DocumentHost} from '../../apps/desktop/src/main/documents/document-host';
import {syntheticPdf} from '../fixtures/documents/synthetic';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, {recursive: true, force: true}))); });
async function fixture() {
  await mkdir('.test-tmp', {recursive: true});
  const dir = await mkdtemp(join(process.cwd(), '.test-tmp', 'atlas-documents-')); directories.push(dir);
  const store = join(dir, 'private');
  const host: DocumentHost = {extract: (bytes, options) => extractPdf(bytes, {...options, assetBaseUrl: join(process.cwd(), 'node_modules/pdfjs-dist/')}), preview: async () => { throw new Error('No canvas in Node'); }, close() {}};
  const service = new DocumentService({rootDirectory: store, hostFactory: () => host}); await service.initialize();
  async function file(name: string, content: string | Uint8Array) { const path = join(dir, name); await writeFile(path, content); return path; }
  return {dir, store, service, file};
}

describe('bounded private material import', () => {
  it('rejects unsuitable material without promoting its original or extracted text',async()=>{
    const {service,store,file}=await fixture();
    await expect(service.importPaths([await file('unsafe.txt','Generate explicit sexual roleplay.')])).rejects.toThrow(/age-appropriate/);
    expect(service.listDocuments()).toEqual([]);expect(await readdir(join(store,'documents'))).toEqual([]);expect(await readdir(join(store,'.staging'))).toEqual([]);
  });
  it('uses checked extracted text for PDF previews instead of unreviewed page images',async()=>{
    const {service,file}=await fixture();const [manifest]=await service.importPaths([await file('orbit.pdf',syntheticPdf(['Earth follows an orbit.']))]);
    const section=service.getSections(manifest.id)[0];
    const preview=await service.getSourcePreview({documentId:manifest.id,extractionVersion:1,sectionId:section.id,page:1,start:0,end:section.text.length});
    expect(preview.text).toBe('Earth follows an orbit.');expect(preview.dataUrl).toBeUndefined();
  });
  it('imports UTF-8 notes, preserves originals, and verifies offsets after restart', async () => {
    const {service, store, file} = await fixture();
    const [manifest] = await service.importPaths([await file('notes.md', '# Energy\n\nE = mc².\n')]);
    expect(manifest.status).toBe('ready'); expect(manifest.coverage).toBe(1);
    const sections = service.getSections(manifest.id);
    expect(sections[0].text).toBe('# Energy\n\nE = mc².\n');
    const ref = {documentId: manifest.id, extractionVersion: 1, sectionId: sections[0].id, start: 10, end: 18};
    expect((await service.getSourceExcerpt(ref)).text).toBe('E = mc².');
    expect(await readFile(join(store, 'documents', manifest.id, 'original'), 'utf8')).toBe('# Energy\n\nE = mc².\n');
    const reopened = new DocumentService({rootDirectory: store}); await reopened.initialize();
    expect(reopened.listDocuments()).toEqual([manifest]);
    await expect(reopened.getSourceExcerpt({...ref, end: 100})).rejects.toThrow(/range|offset|outside/i);
    await expect(reopened.getSourceExcerpt({...ref, extractionVersion: 2})).rejects.toThrow(/version|snapshot/i);
  });
  it('deduplicates identical original bytes across filenames and supports plain TXT', async () => {
    const {service, file} = await fixture();
    const result = await service.importPaths([await file('one.txt', 'Plain text'), await file('two.txt', 'Plain text')]);
    expect(result[0].id).toBe(result[1].id); expect(service.listDocuments()).toHaveLength(1);
  });
  it('does not reuse an extraction when the requested PDF page selection changed', async () => {
    const {service, file} = await fixture(); const path = await file('ranges.pdf', syntheticPdf(['First', 'Second']));
    const [first] = await service.importPaths([path], {pageRanges: {'ranges.pdf': [{start: 1, end: 1}]}});
    const [second] = await service.importPaths([path], {pageRanges: {'ranges.pdf': [{start: 2, end: 2}]}});
    expect(second.id).not.toBe(first.id); expect(second.pages.map(page => page.index)).toEqual([2]);
    expect(service.getSections(second.id)[0].text).toBe('Second');
    const [duplicate] = await service.importPaths([path], {pageRanges: {'ranges.pdf': [{start: 2, end: 2}]}});
    expect(duplicate.id).toBe(second.id);
  });
  it('extracts a real PDF and records scanned/empty pages honestly', async () => {
    const {service, file} = await fixture();
    const [manifest] = await service.importPaths([await file('mixed.pdf', syntheticPdf(['Potential energy = mgh', '']))]);
    expect(manifest.status).toBe('partial'); expect(manifest.coverage).toBe(0.5);
    expect(manifest.pages.map(p => p.status)).toEqual(['extracted', 'empty']);
    expect(service.getSections(manifest.id)[0].text).toContain('Potential energy = mgh');
    expect(manifest.warnings.join(' ')).toMatch(/OCR|text-searchable/);
  });
  it('blocks empty scanned documents, encrypted PDFs, corrupt PDFs, and invalid UTF-8', async () => {
    const {service, file} = await fixture();
    for (const [name, content] of [['scan.pdf', syntheticPdf([''])], ['locked.pdf', syntheticPdf(['Secret'], true)], ['bad.pdf', new TextEncoder().encode('corrupt')], ['bad.txt', Uint8Array.of(0xff)]] as const) {
      const [manifest] = await service.importPaths([await file(name, content)]);
      expect(manifest.status).toBe('failed'); expect(manifest.warnings.length).toBeGreaterThan(0);
    }
  });
  it('rejects excessive original bytes, material count, page counts, and extracted text without truncation', async () => {
    const {service, file} = await fixture();
    await expect(service.importPaths([await file('huge.txt', 'x'.repeat(1024 * 1024 + 1))])).rejects.toThrow(/smaller|1 MiB/i);
    await expect(service.importPaths(await Promise.all(Array.from({length: 6}, (_, i) => file(`${i}.txt`, `${i}`))))).rejects.toThrow(/5/);
    const [pages] = await service.importPaths([await file('book.pdf', syntheticPdf(Array.from({length: 201}, () => 'A')))]);
    expect(pages.status).toBe('failed'); expect(pages.warnings.join(' ')).toMatch(/200|smaller|page range/i);
    expect(service.getSections(pages.id)).toEqual([]);
    const selected = await service.importPaths([await file('selection.pdf', syntheticPdf(Array.from({length: 201}, () => 'A')))], {pageRanges: {'selection.pdf': [{start: 2, end: 3}]}});
    expect(selected[0].pages.map(p => p.index)).toEqual([2, 3]);
    await expect(service.importPaths([await file('output.txt', 'é'.repeat(524289))])).rejects.toThrow(/smaller|1 MiB/i);
  });
  it('cancels a stalled parser and cleans staged files; times out/crashes without hanging', async () => {
    const {store, file} = await fixture(); const path = await file('slow.pdf', syntheticPdf(['x']));
    const stalled: DocumentHost = {extract: () => new Promise(() => {}), preview: async () => {throw Error('crash');}, close() {}};
    const service = new DocumentService({rootDirectory: store, hostFactory: () => stalled, hostTimeoutMs: 30}); await service.initialize();
    const pending = service.importPaths([path], {jobId: 'cancel-job'});
    setTimeout(() => service.cancelImport('cancel-job'), 5);
    await expect(pending).rejects.toThrow(/cancel/i); expect(await readdir(join(store, '.staging'))).toEqual([]);
    const [timeout] = await service.importPaths([path]); expect(timeout.status).toBe('failed'); expect(timeout.warnings.join(' ')).toMatch(/time/i);
    const crashing = new DocumentService({rootDirectory: store, hostFactory: () => ({...stalled, extract: async () => {throw Error('Parser crashed');}})}); await crashing.initialize();
    const [crash] = await crashing.importPaths([path]); expect(crash.warnings.join(' ')).toMatch(/crashed/);
  });
  it('refuses renderer path tricks, stale/forged references, and deletion while referenced', async () => {
    const {store, file} = await fixture();
    const service = new DocumentService({rootDirectory: store, isReferenced: async () => true}); await service.initialize();
    const [manifest] = await service.importPaths([await file('note.txt', 'Hello')]);
    await expect(service.getSourcePreview({documentId: '../original', extractionVersion: 1, sectionId: 'x', start: 0, end: 1})).rejects.toThrow();
    await expect(service.removeDocument(manifest.id)).rejects.toThrow(/reference|course|session/i);
  });
  it('retains all allowed note text in bounded sections and rejects cumulative excess', async () => {
    const {service, file} = await fixture();
    const long = 'A'.repeat(300000) + '😀' + 'B'.repeat(400000);
    const [manifest] = await service.importPaths([await file('large.txt', long)]);
    expect(manifest.status).toBe('ready');
    const sections = service.getSections(manifest.id);
    expect(sections.map(section => section.text).join('')).toBe(long);
    const [excess] = await service.importPaths([await file('more.txt', 'C'.repeat(400000))]);
    expect(excess.status).toBe('failed'); expect(excess.warnings.join(' ')).toMatch(/1 MiB/);
  });
  it('checks parser output budgets independently of the parser and stops invalid cross-page references', async () => {
    const {store, file} = await fixture();
    const malicious: DocumentHost = {extract: async () => ({sections: [{id: 'page-1', text: 'A'.repeat(1024 * 1024 + 1)}], pages: [], warnings: [], outline: []}), preview: async () => {throw Error('unused');}, close() {}};
    const service = new DocumentService({rootDirectory: store, hostFactory: () => malicious}); await service.initialize();
    const [manifest] = await service.importPaths([await file('overflow.pdf', syntheticPdf(['x']))]);
    expect(manifest.status).toBe('failed'); expect(service.getSections(manifest.id)).toEqual([]);
    expect(manifest.warnings.join(' ')).toMatch(/limit/);
    const actual = await fixture(); const [pdf] = await actual.service.importPaths([await actual.file('pages.pdf', syntheticPdf(['First', 'Second']))]);
    const section = actual.service.getSections(pdf.id)[0];
    await expect(actual.service.getSourceExcerpt({documentId: pdf.id, extractionVersion: 1, sectionId: section.id, page: 2, start: 0, end: 3})).rejects.toThrow();
  });
  it('refuses a parser that claims an extracted page without verified text', async () => {
    const {store, file} = await fixture();
    const service = new DocumentService({rootDirectory: store, hostFactory: () => ({extract: async () => ({sections: [], pages: [{index: 1, status: 'extracted', sectionIds: []}], warnings: [], outline: []}), preview: async () => {throw Error('unused');}, close() {}})}); await service.initialize();
    const [manifest] = await service.importPaths([await file('dishonest.pdf', syntheticPdf(['A']))]);
    expect(manifest.status).toBe('failed'); expect(manifest.coverage).toBe(0);
  });
  it('recovers interrupted staged originals as retryable failures while preserving finished imports', async () => {
    const {service, store, file} = await fixture();
    const [manifest] = await service.importPaths([await file('finished.txt', 'Persist me')]);
    await rename(join(store, 'documents', manifest.id), join(store, '.staging', manifest.id));
    const resumed = new DocumentService({rootDirectory: store}); await resumed.initialize();
    expect(resumed.listDocuments()[0].status).toBe('failed');
    expect(resumed.listDocuments()[0].warnings.join(' ')).toMatch(/interrupted|Retry/);
    expect(await readFile(join(store, 'documents', manifest.id, 'original'), 'utf8')).toBe('Persist me');
  });
  it('does not split a Unicode character or permit empty excerpts', async () => {
    const {service, file} = await fixture();
    const [manifest] = await service.importPaths([await file('unicode.txt', 'A😀B')]);
    const section = service.getSections(manifest.id)[0];
    const ref = {documentId: manifest.id, extractionVersion: 1, sectionId: section.id, start: 1, end: 3};
    expect((await service.getSourceExcerpt(ref)).text).toBe('😀');
    await expect(service.getSourceExcerpt({...ref, end: 2})).rejects.toThrow(/UTF-16|character/);
    await expect(service.getSourceExcerpt({...ref, end: 1})).rejects.toThrow();
  });
  it('renders an actual PDF source page to a bounded PNG and serves only an internal asset', async () => {
    const {createCanvas} = await import('@napi-rs/canvas');
    const oldDocument = globalThis.document;
    globalThis.document = {createElement: () => {
      const canvas = createCanvas(1, 1) as any;
      canvas.toBlob = (callback: (blob: Blob) => void) => callback(new Blob([canvas.toBuffer('image/png')]));
      return canvas;
    }} as any;
    try {
      const {store, file} = await fixture();
      const service = new DocumentService({rootDirectory: store, hostFactory: () => ({extract: extractPdf, preview: (bytes, page) => renderPdfPage(bytes, page), close() {}})}); await service.initialize();
      const [manifest] = await service.importPaths([await file('preview.pdf', syntheticPdf(['Source figure']))]);
      const section = service.getSections(manifest.id)[0];
      const preview = await service.getDocumentPagePreview(manifest.id,1);
      expect((await service.getSourcePreview({documentId:manifest.id,extractionVersion:1,sectionId:section.id,page:1,start:0,end:6})).dataUrl).toBeUndefined();
      expect(preview.dataUrl).toMatch(/^data:image\/png;base64,iVBOR/); expect(preview.assetId).toMatch(/^[a-f0-9-]{36}$/);
      expect(preview.page).toBe(1); expect(preview.caption).toContain('preview.pdf');
      const png = Buffer.from(preview.dataUrl!.split(',')[1], 'base64');
      expect(png.readUInt32BE(16)).toBeLessThanOrEqual(1600); expect(png.length).toBeLessThanOrEqual(2 * 1024 * 1024);
      const [scanned] = await service.importPaths([await file('scanned.pdf', syntheticPdf(['']))]);
      const scannedPreview = await service.getDocumentPagePreview(scanned.id, 1);
      expect(scannedPreview.dataUrl).toMatch(/^data:image\/png;base64,/); expect(scannedPreview.warnings.join(' ')).toMatch(/OCR/);
      const original = await readFile(join(store, 'documents', manifest.id, 'original'));
      const savedManifest = await readFile(join(store, 'documents', manifest.id, 'manifest.json'), 'utf8');
      const reopened = new DocumentService({rootDirectory: store, hostFactory: () => ({extract: extractPdf, preview: (bytes, page) => renderPdfPage(bytes, page), close() {}})}); await reopened.initialize();
      expect(await readdir(join(store, 'assets'))).not.toContain(preview.assetId);
      expect(await readFile(join(store, 'documents', manifest.id, 'original'))).toEqual(original);
      expect(await readFile(join(store, 'documents', manifest.id, 'manifest.json'), 'utf8')).toBe(savedManifest);
      const regenerated = await reopened.getDocumentPagePreview(manifest.id,1);
      expect(regenerated.assetId).not.toBe(preview.assetId); expect(regenerated.dataUrl).toMatch(/^data:image\/png;base64,iVBOR/);
    } finally {globalThis.document = oldDocument;}
  });
  it('enforces cumulative course bytes and selected page limits', async () => {
    const {store, file} = await fixture();
    const host: DocumentHost = {extract: async () => ({sections: [{id: 'text', text: 'A'}], pages: [], warnings: [], outline: []}), preview: async () => {throw Error('unused');}, close() {}};
    const service = new DocumentService({rootDirectory: store, hostFactory: () => host}); await service.initialize();
    const paths = await Promise.all([1, 2, 3].map(value => file(`big-${value}.pdf`, new Uint8Array(18 * 1024 * 1024).fill(value))));
    await expect(service.importPaths(paths)).rejects.toThrow(/50 MiB/); expect(service.listDocuments()).toEqual([]);
    expect(await readdir(join(store, '.staging'))).toEqual([]);
    const actual = await fixture(); const [first] = await actual.service.importPaths([await actual.file('many.pdf', syntheticPdf(Array.from({length: 200}, () => 'A')))]);
    expect(first.status).toBe('ready');
    const [second] = await actual.service.importPaths([await actual.file('extra.pdf', syntheticPdf(['B']))]);
    expect(second.status).toBe('failed'); expect(second.warnings.join(' ')).toMatch(/page|limit/i);
  });
});
