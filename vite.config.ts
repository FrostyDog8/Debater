/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project URL: https://<user>.github.io/DebateRoulette/
const base = process.env.VITE_BASE ?? (process.env.NODE_ENV === 'production' ? '/DebateRoulette/' : '/');

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
