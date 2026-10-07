import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// jsPDF dynamically imports the optional "canvg" package for SVG rasterization,
// which this app never uses. Stub it out so the (lazily loaded) package is never
// resolved — this also avoids pulling canvg's heavy deps into the graph.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      canvg: fileURLToPath(new URL('./src/shims/canvg.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    watch: {
      // The workspace lives on a network/redirected drive (X:\) where fs.watch
      // crashes with ECONNRESET. Polling avoids native file-change events.
      usePolling: true,
      interval: 1000,
    },
  },
});
