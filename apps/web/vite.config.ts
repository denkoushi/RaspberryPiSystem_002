import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    host: '0.0.0.0',
    proxy: {
      // API/WSをAPIサーバー(8080)へフォワード。CIのPlaywright実行時も同じオリジンでアクセスさせる
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      },
      '/ws': {
        target: 'http://localhost:8080',
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
