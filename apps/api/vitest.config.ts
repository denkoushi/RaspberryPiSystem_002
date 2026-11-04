import { defineConfig } from 'vitest/config';

const coverageThresholds = process.env.COVERAGE_ENFORCE_THRESHOLDS === 'true'
  ? {
      statements: 69,
      branches: 57,
      functions: 76,
      lines: 71,
    }
  : undefined;

// API_TEST_PER_WORKER_DB=1: globalSetup が DATABASE_URL の DB を worker 数だけ複製し
// (<name>_w1..N)、setup-env.ts が VITEST_POOL_ID で各 worker の DB と保存先を切り替える。
const perWorkerDb = process.env.API_TEST_PER_WORKER_DB === '1';

// sharp の画像処理だけで 1 テスト 25 秒前後かかる CPU 律速ファイル。他ファイルと並列に走らせると
// CPU 競合で testTimeout(30 秒)を超えるため、並列グループの完了後に単独で実行する。
const cpuBoundSerialFiles = [
  'src/services/part-measurement/part-measurement-drawing-ocr-engine.test.ts',
  'src/services/assembly/__tests__/procedure-material-gmail.test.ts',
];

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup-env.ts'],
    // NOTE:
    // 共有DBを使うテストが integration 以外にも多く、1つのDBをファイル並列で共有すると Prisma の
    // deleteMany 等が他ファイルと競合して P2003 などのフレークを起こす。そのため既定（ローカルの
    // 単一DB）は直列実行に固定する。API_TEST_PER_WORKER_DB=1 のときは worker ごとに DB と保存先が
    // 分かれるのでファイル並列にする（CI の api ジョブはこのモードで --maxWorkers を指定して実行する）。
    fileParallelism: perWorkerDb,
    sequence: {
      concurrent: false
    },
    testTimeout: 30000, // 30秒のタイムアウト
    hookTimeout: 30000, // フックのタイムアウトも30秒
    exclude: ['dist/**', 'node_modules/**'],
    projects: [
      {
        extends: true,
        test: {
          name: 'api',
          include: ['src/**/*.{test,spec}.ts'],
          exclude: ['dist/**', 'node_modules/**', ...cpuBoundSerialFiles],
          globalSetup: ['./src/test/per-worker-db.global-setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'api-cpu-bound',
          include: cpuBoundSerialFiles,
          fileParallelism: false,
          maxWorkers: 1,
          sequence: { groupOrder: 1 },
        },
      },
    ],
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
