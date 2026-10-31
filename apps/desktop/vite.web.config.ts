import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({root:resolve('apps/desktop/src/renderer'),resolve:{alias:Object.fromEntries(['protocol','scene','teacher','voice','simulation','timeline'].map(name=>[`@living-canvas/${name}`,resolve(`packages/${name}/src/index.ts`)]))},server:{port:5173,strictPort:true}});
