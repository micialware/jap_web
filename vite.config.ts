import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl'; // npm i -D @vitejs/plugin-basic-ssl

export default defineConfig({
    plugins: [basicSsl()], // Добавит локальный HTTPS

  build: {
    target: 'esnext',
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