import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup-env.ts'],
    // NOTE:
    // 共有DBを使う統合テストが多く、テストファイル並列実行だと別ファイルのdeleteMany等が割り込んで
    // 外部キー制約(P2003)などのフレークを起こすことがあるため、ファイル単位の並列実行を無効化する。
    fileParallelism: false,
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
