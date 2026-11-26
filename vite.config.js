import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visionRoot } from './scripts/vision-assets.mjs';

export default defineConfig({
  plugins: [react()],
  define: { __MOVANA_VISION_ROOT__: JSON.stringify(`/${visionRoot}`) },
  build: { target: 'es2022' },
});
