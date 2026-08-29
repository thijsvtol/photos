import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Strip console.* calls from production builds */
function stripConsole(): Plugin {
  return {
    name: 'strip-console',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('node_modules') || !code.includes('console.')) return null;
      // Replace console method references with no-op so console.log("x") becomes (() => {})("x")
      const stripped = code.replace(
        /\bconsole\.(log|warn|error|debug|info|trace)\b/g,
        '(() => {})'
      );
      return stripped !== code ? stripped : null;
    },
  };
}

export default defineConfig({
  plugins: [react(), stripConsole()],
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
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/leaflet') || id.includes('node_modules/react-leaflet')) {
            return 'map-vendor';
          }
          if (id.includes('node_modules/react-masonry-css') || id.includes('node_modules/lucide-react')) {
            return 'ui-vendor';
          }
          if (id.includes('node_modules/axios') || id.includes('node_modules/ulid') || id.includes('node_modules/exifreader') || id.includes('node_modules/dexie')) {
            return 'utils';
          }
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
