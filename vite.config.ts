import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { orionRelay } from './server/relay.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [orionRelay()],
  server: { host: true, port: 5173, strictPort: true },
  // Pre-scan lazily-loaded mission modules so the dev server never reloads mid-demo.
  optimizeDeps: { entries: ['index.html', 'controller/index.html', 'src/missions/**/*.ts'] },
  preview: { host: true, port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: here('./index.html'),
        controller: here('./controller/index.html'),
      },
    },
  },
});
