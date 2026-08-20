/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project URL: https://<user>.github.io/Debater/
const base = process.env.VITE_BASE ?? (process.env.NODE_ENV === 'production' ? '/Debater/' : '/');

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        lab: resolve(__dirname, 'lab.html'),
      },
    },
  },
  test: {
    environment: 'node',
  },
});
