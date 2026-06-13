import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
  },
  optimizeDeps: {
    exclude: ['wa-sqlite'],
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    host: true
  },
});