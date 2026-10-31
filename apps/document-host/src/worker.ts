import {getDocument, type PDFDocumentProxy} from 'pdfjs-dist/legacy/build/pdf.mjs';

export const DOCUMENT_LIMITS = Object.freeze({materials: 5, pdfBytes: 25 * 1024 * 1024, textBytes: 1024 * 1024, courseBytes: 50 * 1024 * 1024, pages: 200, extractedBytes: 1024 * 1024, excerptCharacters: 16000, previewBytes: 2 * 1024 * 1024, previewEdge: 1600, hostTimeoutMs: 60000});
export type PageRange = {start: number; end: number};
export type ExtractionOptions = {maxPages: number; maxTextBytes: number; pageRanges?: PageRange[]; signal?: AbortSignal; onProgress?: (processed: number, total: number) => void; assetBaseUrl?: string};
export type ExtractedDocument = {sections: {id: string; page?: number; title?: string; text: string}[]; pages: {index: number; label?: string; status: 'extracted' | 'empty' | 'failed'; sectionIds: string[]}[]; warnings: string[]; outline: {title: string; page?: number}[]};
export type RenderedPage = {png: Uint8Array; width: number; height: number};
const aborted = (signal?: AbortSignal) => {if (signal?.aborted) throw new Error('Document import cancelled');};
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

async function openPdf(bytes: Uint8Array, assetBaseUrl?: string) {
  // Only data is accepted: PDFs cannot select URLs or request credentials. No PDF
  // annotation/action/scripting APIs are invoked, and font eval is disabled.
  return getDocument({data: Uint8Array.from(bytes), enableXfa: false, useSystemFonts: false, disableFontFace: true,
    ...(assetBaseUrl ? {cMapUrl: `${assetBaseUrl}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assetBaseUrl}standard_fonts/`, wasmUrl: `${assetBaseUrl}wasm/`} : {})});
}

export async function extractPdf(bytes: Uint8Array, options: ExtractionOptions): Promise<ExtractedDocument> {
  aborted(options.signal);
  const task = await openPdf(bytes, options.assetBaseUrl);
  const cancel = () => {void task.destroy();}; options.signal?.addEventListener('abort', cancel, {once: true});
  let pdf: PDFDocumentProxy | undefined;
  try {
    pdf = await task.promise; aborted(options.signal);
    const ranges = options.pageRanges;
    if (ranges && (ranges.length > 200 || ranges.some(r => !Number.isSafeInteger(r.start) || !Number.isSafeInteger(r.end) || r.start < 1 || r.end < r.start || r.end > pdf!.numPages))) throw Error('Choose a valid PDF page range');
    if ((!ranges && pdf.numPages > options.maxPages) || (ranges && ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0) > options.maxPages)) throw Error(`This PDF exceeds the ${options.maxPages} selected page limit. Choose a page range or a smaller PDF.`);
    const selected = ranges ? [...new Set(ranges.flatMap(r => Array.from({length: r.end - r.start + 1}, (_, i) => r.start + i)))].sort((a, b) => a - b) : Array.from({length: pdf.numPages}, (_, i) => i + 1);
    if (selected.length > options.maxPages) throw Error(`This PDF exceeds the ${options.maxPages} selected page limit. Choose a page range or a smaller PDF.`);
    const result: ExtractedDocument = {sections: [], pages: [], warnings: ['PDF formulas and layout are extracted as available text; verify equations against the original page. Raster-only figures are source evidence, and their contents have not been interpreted.'], outline: []};
    if (selected.length !== pdf.numPages) result.warnings.push(`Only the selected ${selected.length} of ${pdf.numPages} physical pages were imported.`);
    const labels = await pdf.getPageLabels().catch(() => null);
    const outline = await pdf.getOutline().catch(() => null);
    if (outline) {
      const visit = (items: typeof outline, depth: number) => {if (depth > 8) return; for (const item of items) {if (result.outline.length >= 200) break; result.outline.push({title: String(item.title).slice(0, 500)}); if (item.items?.length) visit(item.items, depth + 1);}};
      visit(outline, 0);
    }
    let total = 0;
    for (const index of selected) {
      aborted(options.signal); const id = `page-${index}`;
      let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | undefined;
      try {
        page = await pdf.getPage(index);
        const content = await page.getTextContent({disableNormalization: false});
        const pieces: string[] = []; let pageBytes = 0;
        for (const item of content.items) {
          if (!('str' in item)) continue;
          const piece = item.str + (item.hasEOL ? '\n' : ' '); pageBytes += byteLength(piece);
          if (total + pageBytes > options.maxTextBytes) throw Error('Extracted text exceeds the 1 MiB course limit. Choose fewer pages or a smaller document.');
          pieces.push(piece);
        }
        const text = pieces.join('').replace(/[ \t]+\n/g, '\n').trim(); total += byteLength(text);
        result.pages.push({index, ...(labels?.[index - 1] ? {label: labels[index - 1].slice(0, 100)} : {}), status: text ? 'extracted' : 'empty', sectionIds: text ? [id] : []});
        if (text) result.sections.push({id, page: index, title: `Page ${labels?.[index - 1] || index}`, text});
      } catch (error) {
        aborted(options.signal);
        if (error instanceof Error && /exceeds/.test(error.message)) throw error;
        result.pages.push({index, status: 'failed', sectionIds: []});
      } finally {page?.cleanup();}
      options.onProgress?.(result.pages.length, selected.length);
    }
    const unreadable = result.pages.filter(p => p.status !== 'extracted');
    if (unreadable.length) result.warnings.push(`${unreadable.length} selected page(s) have no readable text. OCR is unavailable; use a text-searchable PDF or UTF-8 TXT for those pages.`);
    return result;
  } finally {options.signal?.removeEventListener('abort', cancel); await task.destroy();}
}

export function extractNotes(bytes: Uint8Array, markdown: boolean, options: ExtractionOptions): ExtractedDocument {
  aborted(options.signal);
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes).replace(/\r\n?/g, '\n');
  if (byteLength(text) > options.maxTextBytes) throw Error('Extracted text exceeds the 1 MiB course limit. Choose a smaller file.');
  // Markdown is retained as plain evidence; it is never converted to HTML.
  return {sections: text.trim() ? [{id: 'section-1', ...(markdown ? {title: text.match(/^#{1,6}\s+(.+)$/m)?.[1]?.slice(0, 500)} : {}), text}] : [], pages: [], warnings: text.trim() ? [] : ['No readable text was found. Choose a UTF-8 TXT or text-searchable PDF.'], outline: []};
}

export async function renderPdfPage(bytes: Uint8Array, index: number, options: {signal?: AbortSignal; assetBaseUrl?: string} = {}): Promise<RenderedPage> {
  aborted(options.signal); const task = await openPdf(bytes, options.assetBaseUrl);
  const cancel = () => {void task.destroy();}; options.signal?.addEventListener('abort', cancel, {once: true});
  try {
    const pdf = await task.promise;
    if (!Number.isSafeInteger(index) || index < 1 || index > pdf.numPages) throw Error('Invalid source page');
    const page = await pdf.getPage(index); const base = page.getViewport({scale: 1});
    const scale = Math.min(1.75, DOCUMENT_LIMITS.previewEdge / Math.max(base.width, base.height));
    const viewport = page.getViewport({scale}); const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d', {alpha: false}); if (!context) throw Error('Local page preview is unavailable');
    try {
      await page.render({canvas, canvasContext: context, viewport, annotationMode: 0}).promise; aborted(options.signal);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('Preview encoding failed')), 'image/png'));
      if (blob.size > DOCUMENT_LIMITS.previewBytes) throw Error('This page preview is too large; use the original PDF.');
      return {png: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height};
    } finally {canvas.width = 0; canvas.height = 0; page.cleanup();}
  } finally {options.signal?.removeEventListener('abort', cancel); await task.destroy();}
}
