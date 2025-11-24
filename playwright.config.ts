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

  webServer: [
    {
      command: 'pnpm test:postgres:start',
      port: 5432,
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      command: 'cd apps/api && pnpm dev',
      port: 8080,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/borrow_return',
        JWT_ACCESS_SECRET: 'test-access-secret-1234567890',
        JWT_REFRESH_SECRET: 'test-refresh-secret-1234567890',
      },
    },
    {
      command: 'cd apps/web && pnpm dev',
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});

