import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/media': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React core
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // Map libraries (usually large)
          'map-vendor': ['leaflet', 'react-leaflet'],
          // UI libraries
          'ui-vendor': ['react-masonry-css', 'lucide-react'],
          // Utilities
          'utils': ['axios', 'ulid', 'exifreader', 'dexie'],
        },
      },
    },
    chunkSizeWarningLimit: 600, // Increase slightly from default 500
  },
  optimizeDeps: {
    // Exclude FFmpeg from optimization so wasm files are handled correctly
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
