import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  base: '/mallofhorror/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@engine': resolve(__dirname, 'src/engine'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/engine/**'],
    },
  },
})
