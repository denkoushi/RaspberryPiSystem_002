import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
  server: {
    port: 4173,
    host: '0.0.0.0',
    proxy: {
      // API/WSをAPIサーバー(8080)へフォワード。CIのPlaywright実行時も同じオリジンでアクセスさせる
      '/api': {
        // macOSでは localhost が ::1 を優先し、APIがIPv4のみで待ち受けていると proxy が ECONNREFUSED になることがある
        // そのため明示的に 127.0.0.1 を使い、E2E/CIの安定性を上げる
        target: 'http://127.0.0.1:8080',
        changeOrigin: true
      },
      '/ws': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: [
            'react',
            'react-dom',
            'react-router-dom',
            '@tanstack/react-query',
            '@xstate/react',
            'xstate',
            'axios',
            'clsx'
          ]
        }
      }
    }
  }
});
