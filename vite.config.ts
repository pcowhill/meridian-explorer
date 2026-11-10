/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// `base: './'` + hash routing keeps every asset URL and deep link relative, so the
// same build works at https://<user>.github.io/meridian-explorer/, at the domain
// root, and from `vite preview` with no per-host configuration.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    chunkSizeWarningLimit: 2600,
    rollupOptions: {
      output: {
        // Keep the (large, rarely changing) knowledge model and the vendor code in
        // their own cacheable chunks, separate from the application shell.
        manualChunks(id: string) {
          if (id.includes('/src/model/data/')) return 'meridian-model';
          if (id.includes('node_modules/@xyflow') || id.includes('node_modules/d3-')) return 'vendor-flow';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'vendor-react';
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
