import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      // sharp is required at the top level by @huggingface/transformers but is
      // only used for image tasks, never for ASR. Replace it with a stub so the
      // module loads cleanly in the packaged app where sharp is unavailable.
      sharp: path.resolve(__dirname, 'electron/modules/captions/sharp-stub.cjs'),
    },
  },
  build: {
    minify: true,
    rollupOptions: {
      // @huggingface/transformers is pure JS → bundled into the worker.
      // onnxruntime-node and onnxruntime-common are native/shared → injected into
      // the ASAR node_modules via the packageAfterCopy hook.
      // onnxruntime-web is unused for ASR → excluded.
      external: ['electron', 'onnxruntime-node', 'onnxruntime-common', 'onnxruntime-web'],
    },
  },
});
