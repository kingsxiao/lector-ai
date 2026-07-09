import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    // The backend (api/) was dropped in the BYOK pivot, so its tests are
    // excluded. They remain on disk for reference.
    exclude: ['tests/api/**', 'node_modules/**'],
    globals: false,
    setupFiles: ['tests/setup-env.ts'],
  },
})
