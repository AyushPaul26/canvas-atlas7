import { cpSync, createReadStream, mkdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

/** PDF worker resources stay local in both desktop development and packaged builds. */
export function localPdfAssets(output: string): Plugin {
  const library = resolve('node_modules/pdfjs-dist');
  return {
    name: 'canvas-atlas-local-pdf-assets',
    closeBundle() {
      const target = resolve(output, 'pdfjs'); mkdirSync(target, { recursive: true });
      for (const folder of ['cmaps', 'standard_fonts', 'wasm']) cpSync(resolve(library, folder), resolve(target, folder), { recursive: true });
      cpSync(resolve(library, 'LICENSE'), resolve(target, 'LICENSE'));
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (!path.startsWith('/pdfjs/')) { next(); return; }
        const file = resolve(library, decodeURIComponent(path.slice('/pdfjs/'.length)));
        if (!file.startsWith(library + sep)) { response.statusCode = 403; response.end(); return; }
        try { if (!statSync(file).isFile()) throw new Error('missing'); response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'); createReadStream(file).pipe(response); }
        catch { response.statusCode = 404; response.end(); }
      });
    },
  };
}
