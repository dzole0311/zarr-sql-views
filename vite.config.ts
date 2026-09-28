import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};
export default defineConfig({
  plugins: [react(), tailwind(), wasm()],
  worker: { format: 'es', plugins: () => [wasm()] },
  build: { target: 'esnext' },
  server: { host: '127.0.0.1', headers },
  preview: { host: '127.0.0.1', headers },
  optimizeDeps: { exclude: ['@earthmover/icechunk'] },
});
