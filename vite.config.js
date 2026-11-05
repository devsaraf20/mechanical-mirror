import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true }, // reachable from phones / the ESP32 network
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  build: { chunkSizeWarningLimit: 1500 },
});
