import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup-env.ts'],
    sequence: {
      concurrent: false
    },
    testTimeout: 30000, // 30秒のタイムアウト
    hookTimeout: 30000, // フックのタイムアウトも30秒
    coverage: {
      reporter: ['text', 'lcov'],
      exclude: ['src/types/**']
    },
    // CI環境での詳細なログ出力
    reporters: process.env.CI ? ['verbose'] : ['default']
  }
});
