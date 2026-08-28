import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  // Strip console.log calls from the production bundles (the content script
  // logged on every page otherwise); keep console.warn — it surfaces relay/
  // storage failures users report. `pure` (vs drop) removes only calls with
  // no use of the return value, which is all of ours.
  esbuild: {
    pure: ['console.log'],
  },
  // Pre-bundle stable deps so dev cold-start skips re-scanning them.
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand'],
  },
  build: {
    outDir: 'dist',
    // The extension only runs in modern Chrome (MV3), so target ES2022 to skip
    // down-leveling (class fields, optional chaining, top-level await helpers,
    // etc.). Smaller output, faster to parse, zero compatibility risk.
    target: 'es2022',
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'src/sidepanel/index.html'),
        background: resolve(__dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
