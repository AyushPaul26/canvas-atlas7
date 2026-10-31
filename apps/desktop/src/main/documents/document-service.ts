import {randomUUID, createHash} from 'node:crypto';
import {mkdir, open, readFile, writeFile, readdir, rename, rm} from 'node:fs/promises';
import {basename, extname, isAbsolute, join} from 'node:path';
import {assertSourceRef, documentManifestSchema, documentSectionSchema, type DocumentManifest, type DocumentSection, type SourceRef, type SourceExcerpt, type SourcePreview} from '@living-canvas/protocol';
import type {DocumentHost} from './document-host';
import type {ExtractedDocument, PageRange} from '../../../../document-host/src/worker';
import {AssetStore} from './asset-store';
import {assertLearnerSafe,LearnerSafetyError} from '../../../../../packages/teacher/src/learner-safety';
import type {SafetyGate} from '../safety/contracts';

const LIMITS = {materials: 5, pdf: 25 * 1024 * 1024, text: 1024 * 1024, course: 50 * 1024 * 1024, pages: 200, extracted: 1024 * 1024};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const encoder = new TextEncoder();
export type DocumentImportProgress = {jobId: string; documentId?: string; status: 'starting' | 'extracting' | 'complete' | 'cancelled' | 'failed'; pagesProcessed: number; totalPages: number; warnings: string[]};
export type ImportOptions = {jobId?: string; pageRanges?: Record<string, PageRange[]>; existingDocumentIds?: string[]};
export type DocumentServiceOptions = {rootDirectory: string; safety?:SafetyGate;hostFactory?: () => DocumentHost | Promise<DocumentHost>; hostTimeoutMs?: number; onProgress?: (progress: DocumentImportProgress) => void; isReferenced?: (documentId: string) => boolean | Promise<boolean>};
type Stored = {manifest: DocumentManifest; sections: DocumentSection[]; pageRanges?: PageRange[]};

export class DocumentService {
  private readonly documents = new Map<string, Stored>();
  private readonly previews = new Map<string, string>();
  private readonly assets: AssetStore;
  private initialization?: Promise<void>;
  private active?: {jobId: string; abort: AbortController};
  constructor(private readonly options: DocumentServiceOptions) {this.assets = new AssetStore(join(options.rootDirectory, 'assets'));}
  initialize() {return this.initialization ??= this.load();}
  private async load() {
    await mkdir(join(this.options.rootDirectory, 'documents'), {recursive: true, mode: 0o700});
    await mkdir(join(this.options.rootDirectory, '.staging'), {recursive: true, mode: 0o700}); await this.assets.initialize();
    // A process may die after copying an original and before acknowledging import.
    // Retain that original for inspection/retry, and never claim extraction finished.
    for (const entry of await readdir(join(this.options.rootDirectory, '.staging'), {withFileTypes: true})) {
      if (!entry.isDirectory() || !uuid.test(entry.name)) continue;
      const dir = join(this.options.rootDirectory, '.staging', entry.name);
      try {
        const manifest = documentManifestSchema.parse(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')));
        manifest.status = 'failed'; manifest.coverage = 0; manifest.pages = []; manifest.warnings = ['Import interrupted before completion. Retry by selecting the original file again.'];
        await this.writeStored(dir, {manifest, sections: []});
        await rename(dir, join(this.options.rootDirectory, 'documents', entry.name));
      } catch {await rm(dir, {recursive: true, force: true});}
    }
    for (const entry of await readdir(join(this.options.rootDirectory, 'documents'), {withFileTypes: true})) {
      if (!entry.isDirectory() || !uuid.test(entry.name)) continue;
      try {
        const dir = join(this.options.rootDirectory, 'documents', entry.name);
        const raw = await readFile(join(dir, 'manifest.json'), 'utf8'); if (raw.length > 200000) continue;
        const manifest = documentManifestSchema.parse(JSON.parse(raw)); if (manifest.id !== entry.name) continue;
        const sectionsRaw = await readFile(join(dir, 'sections.json'), 'utf8'); if (Buffer.byteLength(sectionsRaw) > LIMITS.extracted * 7) continue;
        const sections = documentSectionSchema.array().max(4000).parse(JSON.parse(sectionsRaw));
        if (sections.some(s => s.documentId !== manifest.id || s.extractionVersion !== manifest.extractionVersion)) continue;
        const selection = await readFile(join(dir, 'selection.json'), 'utf8').catch(() => 'null');
        const pageRanges = selection.length < 20000 ? this.normalizeRanges(JSON.parse(selection) ?? undefined) : undefined;
        this.documents.set(manifest.id, {manifest, sections, ...(pageRanges ? {pageRanges} : {})});
      } catch {/* An incomplete/corrupt private record cannot become source evidence. */}
    }
  }
  private content(value:Stored){return {manifest:value.manifest,sections:value.sections};}
  listDocuments(): DocumentManifest[] {return [...this.documents.values()].filter(value=>{try{assertLearnerSafe(value,'study-material');return !this.options.safety||this.options.safety.isApproved(this.content(value));}catch(error){if(error instanceof LearnerSafetyError)return false;throw error;}}).map(value => structuredClone(value.manifest));}
  getSections(id: string): DocumentSection[] {return structuredClone(this.get(id).sections);}
  private get(id: string) {if (!uuid.test(id)) throw Error('Invalid document ID'); const value = this.documents.get(id); if (!value) throw Error('Unknown document'); assertLearnerSafe(value,'study-material');this.options.safety?.assertApproved(this.content(value),'study-material');return value;}
  /** Explicit online review; ordinary reads never initiate a classifier request. */
  async reviewDocument(id:string,signal?:AbortSignal):Promise<DocumentManifest>{
    await this.initialize();if(!uuid.test(id))throw Error('Invalid document ID');const value=this.documents.get(id);if(!value)throw Error('Unknown document');
    const content=structuredClone(this.content(value));assertLearnerSafe(content,'study-material');
    await this.options.safety?.inspect(content,'study-material',signal);signal?.throwIfAborted();
    const current=this.documents.get(id);if(!current||JSON.stringify(this.content(current))!==JSON.stringify(content))throw Error('The source material changed during review. Try again.');
    this.options.safety?.assertApproved(content,'study-material');return structuredClone(value.manifest);
  }
  private emit(progress: DocumentImportProgress) {try {this.options.onProgress?.(progress);} catch {/* UI subscribers cannot invalidate a durable import. */}}
  cancelImport(jobId: string) {if (this.active?.jobId === jobId) this.active.abort.abort();}
  private check(signal: AbortSignal) {if (signal.aborted) throw Error('Document import cancelled');}
  private async readOriginal(path: string, maximum: number, signal: AbortSignal) {
    const handle = await open(path, 'r');
    try {
      const info = await handle.stat(); if (!info.isFile()) throw Error('Choose a local material file');
      if (info.size > maximum) throw Error(`Choose a smaller file: ${maximum === LIMITS.pdf ? '25 MiB per PDF' : '1 MiB per text file'} maximum.`);
      // Reserve one extra byte so growth during copying is detected without an
      // unbounded readFile allocation controlled by the selected source file.
      const buffer = Buffer.alloc(info.size + 1); let length = 0;
      while (length < buffer.length) {
        this.check(signal); const read = await handle.read(buffer, length, buffer.length - length, null);
        if (!read.bytesRead) break; length += read.bytesRead;
      }
      const final = await handle.stat();
      if (length !== info.size || final.size !== info.size || final.mtimeMs !== info.mtimeMs) throw Error('Material changed during import. Select the file again.');
      return buffer.subarray(0, length);
    } finally {await handle.close();}
  }
  private async writeStored(directory: string, value: Stored) {
    await writeFile(join(directory, 'sections.json'), JSON.stringify(value.sections), {mode: 0o600});
    await writeFile(join(directory, 'selection.json'), JSON.stringify(value.pageRanges ?? null), {mode: 0o600});
    await writeFile(join(directory, 'manifest.json.tmp'), JSON.stringify(value.manifest), {mode: 0o600});
    await rename(join(directory, 'manifest.json.tmp'), join(directory, 'manifest.json'));
  }
  private normalizeRanges(ranges?: PageRange[]): PageRange[] | undefined {
    if (ranges === undefined) return undefined;
    if (!Array.isArray(ranges) || !ranges.length || ranges.length > 200 || ranges.some(range => !range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 1 || range.end < range.start || range.end > 1000000) || ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0) > 200) throw Error('Choose a valid PDF page range of at most 200 pages');
    return ranges.map(range => ({start: range.start, end: range.end})).sort((a, b) => a.start - b.start || a.end - b.end);
  }
  async importPaths(paths: string[], options: ImportOptions = {}): Promise<DocumentManifest[]> {
    await this.initialize();
    if (this.active) throw Error('A material import is already running');
    if (!Array.isArray(paths) || paths.length > LIMITS.materials) throw Error('Choose at most 5 materials per course');
    if (!paths.length) return [];
    const jobId = options.jobId ?? randomUUID();
    if (typeof jobId !== 'string' || jobId.length < 1 || jobId.length > 100) throw Error('Invalid import job ID');
    const abort = new AbortController(); const signal = abort.signal; this.active = {jobId, abort};
    const staged: {directory: string; value: Stored}[] = [];
    this.emit({jobId, status: 'starting', pagesProcessed: 0, totalPages: 0, warnings: []});
    try {
      const course = (options.existingDocumentIds ? options.existingDocumentIds.map(id => this.get(id)) : [...this.documents.values()]).filter(value => value.manifest.status !== 'failed');
      const uniqueCourse = [...new Map(course.map(value => [value.manifest.id, value])).values()];
      let materials = uniqueCourse.length; let bytes = uniqueCourse.reduce((n, v) => n + v.manifest.byteSize, 0);
      let pages = uniqueCourse.reduce((n, v) => n + v.manifest.pages.length, 0);
      let textBytes = uniqueCourse.reduce((n, v) => n + v.sections.reduce((sum, section) => sum + encoder.encode(section.text).length, 0), 0);
      this.checkBudget(materials, bytes, pages, textBytes);
      const results: DocumentManifest[] = []; const batch = new Map<string, Stored>();
      for (const path of paths) {
        this.check(signal);
        if (typeof path !== 'string' || !isAbsolute(path)) throw Error('Choose a local file with the native file picker');
        assertLearnerSafe(basename(path),'study-material');
        const extension = extname(path).toLowerCase();
        if (!['.pdf', '.txt', '.md', '.markdown'].includes(extension)) throw Error('Choose a PDF, UTF-8 TXT, or Markdown file');
        const pdf = extension === '.pdf';
        const original = await this.readOriginal(path, pdf ? LIMITS.pdf : LIMITS.text, signal); this.check(signal);
        const hash = createHash('sha256').update(original).digest('hex');
        const pageRanges = pdf ? this.normalizeRanges(options.pageRanges?.[basename(path)]) : undefined;
        const selectionKey = JSON.stringify(pageRanges ?? null); const batchKey = `${hash}:${selectionKey}`;
        const prior = batch.get(batchKey) ?? [...this.documents.values()].find(v => v.manifest.sha256 === hash && v.manifest.status !== 'failed' && JSON.stringify(v.pageRanges ?? null) === selectionKey);
        if (prior) {
          assertLearnerSafe(prior,'study-material');
          if(this.options.safety&&!this.options.safety.isApproved(this.content(prior)))await this.options.safety.inspect(this.content(prior),'study-material',signal);
          this.check(signal);
          if (!uniqueCourse.some(v => v.manifest.id === prior.manifest.id) && !batch.has(batchKey)) {
            materials++; bytes += prior.manifest.byteSize; pages += prior.manifest.pages.length; textBytes += prior.sections.reduce((n, s) => n + encoder.encode(s.text).length, 0);
            this.checkBudget(materials, bytes, pages, textBytes);
          }
          results.push(structuredClone(prior.manifest)); batch.set(batchKey, prior); continue;
        }
        materials++; bytes += original.length; this.checkBudget(materials, bytes, pages, textBytes);
        const id = randomUUID(); const directory = join(this.options.rootDirectory, '.staging', id); await mkdir(directory, {mode: 0o700});
        const value: Stored = {manifest: {id, name: basename(path).slice(0, 250), mimeType: pdf ? 'application/pdf' : extension === '.txt' ? 'text/plain' : 'text/markdown', byteSize: original.length, sha256: hash, extractionVersion: 1, status: 'extracting', pages: [], warnings: [], coverage: 0, createdAt: new Date().toISOString()}, sections: [], ...(pageRanges ? {pageRanges} : {})};
        staged.push({directory, value}); await writeFile(join(directory, 'original'), original, {mode: 0o600, flag: 'wx'}); await this.writeStored(directory, value);
        this.check(signal);
        let host: DocumentHost | undefined;
        try {
          let extracted: ExtractedDocument;
          if (pdf) {
            if (!this.options.hostFactory) throw Error('The isolated PDF parser is unavailable. Retry after restarting Canvas Atlas.');
            host = await this.options.hostFactory(); this.check(signal);
            extracted = await this.bounded(host.extract(original, {maxPages: LIMITS.pages - pages, maxTextBytes: LIMITS.extracted - textBytes, pageRanges, signal,
              onProgress: (processed, total) => this.emit({jobId, documentId: id, status: 'extracting', pagesProcessed: processed, totalPages: total, warnings: []})}), host, signal);
          } else {
            const text = new TextDecoder('utf-8', {fatal: true}).decode(original).replace(/\r\n?/g, '\n');
            if (encoder.encode(text).length > LIMITS.extracted - textBytes) throw Error('Extracted text exceeds the 1 MiB course limit. Choose a smaller file.');
            extracted = {sections: text.trim() ? [{id: 'section-1', text, ...(extension !== '.txt' ? {title: text.match(/^#{1,6}\s+(.+)$/m)?.[1]?.slice(0, 500)} : {})}] : [], pages: [], warnings: [], outline: []};
          }
          this.check(signal); this.acceptExtraction(value, extracted, LIMITS.pages - pages, LIMITS.extracted - textBytes);
          pages += value.manifest.pages.length; textBytes += value.sections.reduce((n, section) => n + encoder.encode(section.text).length, 0);
        } catch (error) {
          if(error instanceof LearnerSafetyError)throw error;
          this.check(signal); value.manifest.status = 'failed'; value.manifest.pages = []; value.sections = []; value.manifest.coverage = 0;
          const message = error instanceof Error && /password/i.test(error.name + error.message) ? 'This PDF is password protected. Export an unlocked, text-searchable copy and retry.' : error instanceof Error ? error.message.slice(0, 500) : 'Document extraction failed. Choose a smaller text-searchable file.';
          value.manifest.warnings = [message];
        } finally {host?.close();}
        // All extracted sections are reviewed before the record becomes a source.
        await this.options.safety?.inspect(this.content(value),'study-material',signal);this.check(signal);
        await this.writeStored(directory, value); batch.set(batchKey, value); results.push(structuredClone(value.manifest));
      }
      this.check(signal);
      // Only fully settled records leave staging; cancellation never leaves an
      // acknowledged partial course behind.
      for (const {directory, value} of staged) {await rename(directory, join(this.options.rootDirectory, 'documents', value.manifest.id)); this.documents.set(value.manifest.id, value);}
      this.emit({jobId, status: 'complete', pagesProcessed: pages, totalPages: pages, warnings: results.flatMap(v => v.warnings).slice(0, 20)});
      return results;
    } catch (error) {
      for (const {directory} of staged) await rm(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 50});
      this.emit({jobId, status: signal.aborted ? 'cancelled' : 'failed', pagesProcessed: 0, totalPages: 0, warnings: [error instanceof Error ? error.message.slice(0, 500) : 'Import failed']});
      throw error;
    } finally {this.active = undefined;}
  }
  private checkBudget(materials: number, bytes: number, pages: number, text: number) {
    if (materials > LIMITS.materials) throw Error('Choose at most 5 materials per course');
    if (bytes > LIMITS.course) throw Error('Course materials exceed 50 MiB. Choose smaller files.');
    if (pages > LIMITS.pages) throw Error('Choose at most 200 PDF pages per course; select a page range or smaller files.');
    if (text > LIMITS.extracted) throw Error('Course extracted text exceeds 1 MiB. Choose fewer pages or smaller files.');
  }
  private acceptExtraction(value: Stored, extracted: ExtractedDocument, maxPages: number, maxBytes: number) {
    assertLearnerSafe({name:value.manifest.name,extracted},'study-material');
    if (!extracted || !Array.isArray(extracted.sections) || !Array.isArray(extracted.pages) || extracted.sections.length > 4000 || extracted.pages.length > maxPages) throw Error('Document parser exceeded output limits. Choose fewer pages.');
    let total = 0; const ids = new Set<string>(); const replacements = new Map<string, string[]>();
    const sections = extracted.sections.flatMap(section => {
      if (typeof section.text !== 'string' || typeof section.id !== 'string' || section.id.length > 100 || ids.has(section.id)) throw Error('Invalid document extraction');
      ids.add(section.id); total += encoder.encode(section.text).length;
      if (total > maxBytes) throw Error('Document extraction exceeds the 1 MiB course limit. Choose fewer pages.');
      const chunks: DocumentSection[] = [];
      for (let start = 0; start < section.text.length;) {
        let end = Math.min(section.text.length, start + 200000);
        if (end < section.text.length && /[\uD800-\uDBFF]/.test(section.text[end - 1]) && /[\uDC00-\uDFFF]/.test(section.text[end])) end--;
        chunks.push(documentSectionSchema.parse({...section, id: section.text.length <= 200000 ? section.id : `${section.id}:part-${chunks.length + 1}`, text: section.text.slice(start, end), documentId: value.manifest.id, extractionVersion: 1}));
        start = end;
      }
      replacements.set(section.id, chunks.map(chunk => chunk.id)); return chunks;
    });
    const pages = extracted.pages.map(page => {
      if (!Number.isSafeInteger(page.index) || page.index < 1 || !['extracted', 'empty', 'failed'].includes(page.status) || !Array.isArray(page.sectionIds) || page.sectionIds.some(id => !ids.has(id))) throw Error('Invalid document page extraction');
      return {...page, sectionIds: page.sectionIds.flatMap(id => replacements.get(id) ?? []), ...(page.label ? {label: String(page.label).slice(0, 100)} : {})};
    });
    if (new Set(pages.map(page => page.index)).size !== pages.length) throw Error('Duplicate source page');
    if (new Set(sections.map(section => section.id)).size !== sections.length) throw Error('Duplicate extracted section');
    for (const page of pages) {
      const pageSections = sections.filter(section => section.page === page.index);
      if (page.sectionIds.length !== pageSections.length || pageSections.some(section => !page.sectionIds.includes(section.id) || !section.text.trim()) || (page.status === 'extracted') !== (pageSections.length > 0)) throw Error('Document page coverage does not match verified extracted text');
    }
    if (sections.some(section => section.page !== undefined && !pages.some(page => page.index === section.page))) throw Error('Extracted section has no source page');
    value.sections = sections; value.manifest.pages = pages;
    value.manifest.warnings = (Array.isArray(extracted.warnings) ? extracted.warnings : []).slice(0, 18).map(warning => String(warning).slice(0, 500));
    if (extracted.outline?.length) value.manifest.warnings.push(`Available outline: ${extracted.outline.slice(0, 20).map(item => String(item.title).slice(0, 40)).join('; ')}`.slice(0, 500));
    value.manifest.coverage = pages.length ? pages.filter(page => page.status === 'extracted').length / pages.length : sections.length ? 1 : 0;
    value.manifest.status = value.manifest.coverage === 1 ? 'ready' : value.manifest.coverage > 0 ? 'partial' : 'failed';
    if (!sections.length) value.manifest.warnings.push('No readable content is available for course generation. Choose a text-searchable PDF or UTF-8 TXT. OCR is unavailable.');
    value.manifest = documentManifestSchema.parse(value.manifest);
  }
  private async bounded<T>(promise: Promise<T>, host: DocumentHost, signal?: AbortSignal): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined; let cancel: (() => void) | undefined;
    try {return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      cancel = () => {host.close(); reject(Error('Document import cancelled'));}; signal?.addEventListener('abort', cancel, {once: true});
      if (signal?.aborted) {cancel(); return;}
      timer = setTimeout(() => {host.close(); reject(Error('Document parser timed out. Retry with fewer pages or a smaller file.'));}, this.options.hostTimeoutMs ?? 60000);
    })]);} finally {if (timer) clearTimeout(timer); if (cancel) signal?.removeEventListener('abort', cancel);}
  }
  private resolveRef(ref: SourceRef) {
    if (!ref || typeof ref !== 'object') throw Error('Invalid source reference'); const value = this.get(ref.documentId);
    if (ref.extractionVersion !== value.manifest.extractionVersion) throw Error('Source extraction version is stale');
    if (!Number.isSafeInteger(ref.start) || !Number.isSafeInteger(ref.end) || ref.end - ref.start > 16000) throw Error('Source range or offset is invalid');
    assertSourceRef(ref, value.sections);
    const section = value.sections.find(s => s.id === ref.sectionId)!;
    return {value, section};
  }
  async getSourceExcerpt(ref: SourceRef): Promise<SourceExcerpt> {
    await this.initialize(); const {value, section} = this.resolveRef(ref);
    return {ref: structuredClone(ref), text: section.text.slice(ref.start, ref.end), ...(section.page ? {pageLabel: value.manifest.pages.find(p => p.index === section.page)?.label ?? String(section.page)} : {}), warnings: value.manifest.warnings.slice(0, 20)};
  }
  async getSourcePreview(ref: SourceRef): Promise<SourcePreview> {
    await this.initialize(); const {value, section} = this.resolveRef(ref); const manifest = value.manifest;
    const pageLabel=section.page?(manifest.pages.find(page=>page.index===section.page)?.label??String(section.page)):undefined;
    return {documentId:manifest.id,caption:manifest.name,text:section.text.slice(ref.start,ref.end),...(section.page?{page:section.page,pageLabel}:{}),warnings:manifest.mimeType==='application/pdf'?[...manifest.warnings.slice(0,19),'Text preview: embedded images are not displayed because they have not been reviewed by learner safety checks.']:manifest.warnings};
  }
  /** Internal parser inspection only. Text approval never approves embedded images; do not expose this through IPC. */
  async getDocumentPagePreview(documentId: string, page: number): Promise<SourcePreview> {
    await this.initialize(); const {manifest} = this.get(documentId);
    if (manifest.mimeType !== 'application/pdf' || !Number.isSafeInteger(page) || !manifest.pages.some(item => item.index === page)) throw Error('Unknown imported source page');
    const key = `${manifest.id}:${page}`; let assetId = this.previews.get(key);
    if (!assetId) {
      if (!this.options.hostFactory) throw Error('Local source preview is unavailable');
      const host = await this.options.hostFactory();
      try {
        const bytes = await readFile(join(this.options.rootDirectory, 'documents', manifest.id, 'original'));
        if (bytes.length > LIMITS.pdf || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw Error('Stored original failed integrity verification');
        const rendered = await this.bounded(host.preview(bytes, page), host);
        assetId = await this.assets.putPng(rendered.png); this.previews.set(key, assetId);
      } finally {host.close();}
    }
    const pageLabel = manifest.pages.find(p => p.index === page)?.label ?? String(page);
    return {documentId: manifest.id, page, pageLabel, caption: `${manifest.name} · page ${pageLabel}`, assetId, dataUrl: await this.assets.dataUrl(assetId), warnings: manifest.warnings};
  }
  async removeDocument(id: string) {
    await this.initialize(); this.get(id);
    if (!this.options.isReferenced || await this.options.isReferenced(id)) throw Error('Material may be referenced by a course or lesson session; remove those references first.');
    await rm(join(this.options.rootDirectory, 'documents', id), {recursive: true, force: true}); this.documents.delete(id);
    for (const [key, assetId] of this.previews) if (key.startsWith(`${id}:`)) {await this.assets.remove(assetId); this.previews.delete(key);}
  }
}
