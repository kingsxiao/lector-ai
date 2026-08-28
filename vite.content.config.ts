import { defineConfig } from 'vite'
import { resolve } from 'path'

// Standalone build config for the content script.
//
// MV3 content scripts CANNOT be ES modules (the manifest's content_scripts
// entry has no `type: "module"` option), so content.js must be one
// self-contained file with all shared deps (byok, i18n) inlined. This config
// builds src/content.ts as a single IIFE bundle with no chunk imports and no
// dynamic imports (inlineDynamicImports), then the build script writes it to
// dist/content.js.
export default defineConfig({
  // Match the main config: strip console.log, keep console.warn.
  esbuild: {
    pure: ['console.log'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    // Modern Chrome only — skip down-leveling for a smaller, faster-to-parse
    // content bundle (injected on every page, so size matters here most).
    target: 'es2022',
    rollupOptions: {
      input: resolve(__dirname, 'src/content.ts'),
      output: {
        entryFileNames: 'content.js',
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
})
