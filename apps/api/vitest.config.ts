import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup-env.ts'],
    // NOTE:
    // 共有DBを使うテストが integration 以外にも多く、ファイル並列だと Prisma の deleteMany 等が
    // 他ファイルと競合して P2003 などのフレークを起こすことがあるため、既定では直列実行に固定する。
    // 将来的に「DB 非依存テストだけ並列」へ分離する場合は Vitest projects 等で境界を明示すること。
    fileParallelism: false,
    sequence: {
      concurrent: false
    },
    testTimeout: 30000, // 30秒のタイムアウト
    hookTimeout: 30000, // フックのタイムアウトも30秒
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'lcov'],
      exclude: ['src/types/**']
    },
    // CI環境での詳細なログ出力
    reporters: process.env.CI ? ['verbose'] : ['default']
  }
});
