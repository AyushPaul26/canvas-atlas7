import type {ExtractionOptions, ExtractedDocument, RenderedPage} from '../../../../document-host/src/worker';
import type {BrowserWindow, MessagePortMain} from 'electron';
import {dirname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

export interface DocumentHost {
  extract(bytes: Uint8Array, options: ExtractionOptions): Promise<ExtractedDocument>;
  preview(bytes: Uint8Array, page: number, signal?: AbortSignal): Promise<RenderedPage>;
  close(): void;
}
export type ElectronDocumentHostOptions = {rendererHtml: string; preloadPath: string; devUrl?: string; timeoutMs?: number};

// A host owns exactly one scoped MessagePort and no app/preload capabilities.
export class ElectronDocumentHost implements DocumentHost {
  private window?: BrowserWindow;
  private port?: MessagePortMain;
  private closed = false;
  private pending?: {id: string; resolve(value: unknown): void; reject(error: Error): void; progress?: ExtractionOptions['onProgress']};
  private boot?: Promise<void>;
  constructor(private readonly options: ElectronDocumentHostOptions) {}
  private start() {
    return this.boot ??= (async () => {
      const {BrowserWindow, MessageChannelMain, session} = await import('electron');
      if (this.closed) throw Error('Document host closed');
      const partition = `document-host-${randomUUID()}`; const isolated = session.fromPartition(partition);
      isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      isolated.setPermissionCheckHandler(() => false);
      const root = resolve(dirname(this.options.rendererHtml));
      isolated.webRequest.onBeforeRequest((details, callback) => {
        let allowed = false;
        try {
          const url = new URL(details.url);
          if (url.protocol === 'file:') {const path = resolve(fileURLToPath(url)); allowed = path.startsWith(root + sep);}
          else if (url.protocol === 'blob:') allowed = true;
          else if (this.options.devUrl) {const expected = new URL(this.options.devUrl); allowed = url.origin === expected.origin && ['http:', 'ws:'].includes(url.protocol);}
        } catch {/* Deny malformed locations. */}
        callback({cancel: !allowed});
      });
      isolated.webRequest.onHeadersReceived((details, callback) => callback({responseHeaders: {...details.responseHeaders, 'Content-Security-Policy': ["default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' blob: data:; style-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'"]}}));
      const window = this.window = new BrowserWindow({show: false, webPreferences: {partition, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, webviewTag: false, webSecurity: true, preload: this.options.preloadPath}});
      window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.on('will-redirect', event => event.preventDefault());
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      window.webContents.on('render-process-gone', () => this.closeWithError(Error('Document parser crashed. Retry the import.')));
      const {port1, port2} = new MessageChannelMain(); this.port = port1;
      await new Promise<void>((resolveReady, rejectReady) => {
        const timer = setTimeout(() => {this.close(); rejectReady(Error('Document parser startup timed out'));}, this.options.timeoutMs ?? 15000);
        port1.on('message', ({data}) => {
          if (data?.type === 'ready') {clearTimeout(timer); resolveReady(); return;}
          if (!this.pending || data?.id !== this.pending.id) return;
          if (data.type === 'progress') {if (Number.isSafeInteger(data.processed) && Number.isSafeInteger(data.total)) this.pending.progress?.(data.processed, data.total); return;}
          if (data.type === 'result') {this.pending.resolve(data.result); return;}
          if (data.type === 'error') this.pending.reject(Error(String(data.message).slice(0, 500)));
        });
        port1.start();
        window.webContents.once('did-finish-load', () => window.webContents.postMessage('document:port', null, [port2]));
        const loaded = this.options.devUrl ? window.loadURL(this.options.devUrl) : window.loadFile(this.options.rendererHtml);
        void loaded.catch(error => {clearTimeout(timer); rejectReady(error); this.close();});
      });
    })();
  }
  private async request(operation: string, bytes: Uint8Array, options: Record<string, unknown>, signal?: AbortSignal, progress?: ExtractionOptions['onProgress']): Promise<unknown> {
    if (signal?.aborted) throw Error('Document import cancelled');
    await this.start(); if (this.closed || this.pending) throw Error('Document parser is unavailable or busy');
    return new Promise((resolveResult, reject) => {
      const id = randomUUID(); const cancel = () => this.closeWithError(Error('Document import cancelled'));
      const timer = setTimeout(() => this.closeWithError(Error('Document parser timed out. Choose a smaller file or page range.')), this.options.timeoutMs ?? 60000);
      const finish = () => {clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.pending = undefined;};
      this.pending = {id, resolve: value => {finish(); resolveResult(value);}, reject: error => {finish(); reject(error);}, progress};
      signal?.addEventListener('abort', cancel, {once: true});
      if (signal?.aborted) {cancel(); return;}
      this.port!.postMessage({type: 'run', id, operation, bytes, options});
    });
  }
  extract(bytes: Uint8Array, options: ExtractionOptions): Promise<ExtractedDocument> {
    const {signal, onProgress, ...limits} = options; return this.request('extract', bytes, limits, signal, onProgress) as Promise<ExtractedDocument>;
  }
  preview(bytes: Uint8Array, page: number, signal?: AbortSignal): Promise<RenderedPage> {return this.request('preview', bytes, {page}, signal) as Promise<RenderedPage>;}
  private closeWithError(error: Error) {this.pending?.reject(error); this.close();}
  close() {this.closed = true; this.pending?.reject(Error('Document host closed')); this.port?.close(); if (this.window && !this.window.isDestroyed()) this.window.destroy();}
}
