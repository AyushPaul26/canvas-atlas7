import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';
import { localPdfAssets } from './pdf-assets';
const root = resolve('apps/desktop');
const alias = Object.fromEntries(['protocol','teacher','scene','simulation','timeline','voice'].map(name=>[`@living-canvas/${name}`,resolve(`packages/${name}/src/index.ts`)]));
export default defineConfig({
  main:{resolve:{alias},plugins:[externalizeDepsPlugin({exclude:Object.keys(alias)})],build:{outDir:resolve(root,'out/main'),rollupOptions:{input:{app:resolve(root,'src/main/app.ts')}},target:'node24'}},
  preload:{resolve:{alias},build:{outDir:resolve(root,'out/preload'),rollupOptions:{input:{'app-bridge':resolve(root,'src/preload/app-bridge.ts'),'port-bootstrap':resolve('apps/simulation-host/src/preload/port-bootstrap.ts'),'document-port-bootstrap':resolve('apps/document-host/src/preload.ts')},output:{format:'cjs',entryFileNames:'[name].cjs'}}}},
  renderer:{root:resolve(root,'src/renderer'),plugins:[localPdfAssets(resolve(root,'out/renderer'))],resolve:{alias},build:{outDir:resolve(root,'out/renderer'),rollupOptions:{input:{index:resolve(root,'src/renderer/index.html'),simulation:resolve(root,'src/renderer/simulation.html'),document:resolve(root,'src/renderer/document.html')}}}},
});
