import { defineConfig } from 'vitest/config';

const coverageThresholds = process.env.COVERAGE_ENFORCE_THRESHOLDS === 'true'
  ? {
      statements: 69,
      branches: 57,
      functions: 76,
      lines: 71,
    }
  : undefined;

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup-env.ts'],
    // Local runs share one DB and remain serial to avoid deleteMany/P2003 races.
    // CI opts into worker DB/storage isolation with API_TEST_DB_PER_WORKER=1 and
    // overrides fileParallelism/maxWorkers on the CLI after provisioning worker DBs.
    fileParallelism: false,
    sequence: {
      concurrent: false
    },
    testTimeout: 30000, // 30秒のタイムアウト
    hookTimeout: 30000, // フックのタイムアウトも30秒
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json'],
      exclude: ['dist/**', 'src/types/**'],
      thresholds: coverageThresholds,
    },
    // CI では全テスト名を列挙せず、失敗と遅いテストを中心に表示する。
    reporters: ['default'],
    slowTestThreshold: 1000
  }
});
