import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import {DOCUMENT_LIMITS, extractPdf, renderPdfPage, type ExtractionOptions} from './worker';

GlobalWorkerOptions.workerSrc = workerUrl;
let port: MessagePort | undefined; let busy = false;
// Bundled assets only. The dedicated Electron session denies external requests.
const assetBaseUrl = new URL('./pdfjs/', window.location.href).href;
window.addEventListener('message', event => {
  if (event.source !== window || event.data?.type !== 'canvas-atlas:document-port' || event.ports.length !== 1 || port) return;
  port = event.ports[0];
  port.onmessage = async ({data}) => {
    if (data?.type !== 'run' || typeof data.id !== 'string' || data.id.length > 80 || busy) return;
    busy = true;
    try {
      if (!(data.bytes instanceof Uint8Array) || data.bytes.byteLength > DOCUMENT_LIMITS.pdfBytes) throw Error('Invalid document bytes');
      const input = data.options as Partial<ExtractionOptions> & {page?: number};
      let result;
      if (data.operation === 'extract') {
        if (!Number.isSafeInteger(input.maxPages) || input.maxPages! < 1 || input.maxPages! > DOCUMENT_LIMITS.pages || !Number.isSafeInteger(input.maxTextBytes) || input.maxTextBytes! < 1 || input.maxTextBytes! > DOCUMENT_LIMITS.extractedBytes) throw Error('Invalid extraction limits');
        result = await extractPdf(data.bytes, {...input, maxPages: input.maxPages!, maxTextBytes: input.maxTextBytes!, assetBaseUrl, onProgress: (processed, total) => port?.postMessage({type: 'progress', id: data.id, processed, total})});
      } else if (data.operation === 'preview') result = await renderPdfPage(data.bytes, input.page!, {assetBaseUrl});
      else throw Error('Unknown document operation');
      port?.postMessage({type: 'result', id: data.id, result});
    } catch (error) {port?.postMessage({type: 'error', id: data.id, message: error instanceof Error ? error.message.slice(0, 500) : 'Document parser failed'});}
    finally {busy = false;}
  };
  port.start(); port.postMessage({type: 'ready'});
});
