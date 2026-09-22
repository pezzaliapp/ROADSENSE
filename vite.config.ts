import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// ROAD SENSE - configurazione build.
// `server.host` e' abilitato per poter aprire l'app dal telefono sulla stessa LAN
// durante lo sviluppo (la geolocalizzazione richiede comunque HTTPS o localhost).
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
