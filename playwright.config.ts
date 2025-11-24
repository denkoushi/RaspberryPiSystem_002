import { defineConfig, devices } from '@playwright/test';

/**
 * E2Eテスト設定
 * 
 * テスト実行前に以下を起動する必要があります：
 * 1. PostgreSQLコンテナ: pnpm test:postgres:start
 * 2. APIサーバー: cd apps/api && pnpm dev
 * 3. Webサーバー: cd apps/web && pnpm dev
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // CI環境ではwebServerを使用して自動的にサーバーを起動
  // ローカル環境では、以下のコマンドでサーバーを起動してからテストを実行してください：
  // 1. pnpm test:postgres:start
  // 2. cd apps/api && pnpm dev
  // 3. cd apps/web && pnpm dev
  webServer: process.env.CI ? [
    {
      command: 'pnpm --filter @raspi-system/api dev',
      port: 8080,
      reuseExistingServer: false,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/borrow_return',
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'test-access-secret-1234567890',
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-1234567890',
        NODE_ENV: 'test',
      },
    },
    {
      command: 'pnpm --filter @raspi-system/web dev',
      port: 4173,
      reuseExistingServer: false,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'test',
      },
    },
  ] : undefined,
});

