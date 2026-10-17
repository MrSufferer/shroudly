import {defineConfig} from 'vite';
import wasm from 'vite-plugin-wasm';
import {fileURLToPath} from 'node:url';

const here=fileURLToPath(new URL('.',import.meta.url));
const shim=name=>fileURLToPath(new URL(name,import.meta.url));
export default defineConfig({
  root:here,
  plugins:[wasm()],
  resolve:{alias:{'isomorphic-ws':shim('./ws-shim.mjs'),assert:shim('./assert-shim.mjs')}},
  build:{outDir:fileURLToPath(new URL('./dist/',import.meta.url)),emptyOutDir:true,target:'esnext',chunkSizeWarningLimit:20000},
});
