import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src',
  base: './',
  publicDir: '../public',
  build: { target: 'chrome108', outDir: '../utools/dist', emptyOutDir: true },
})
