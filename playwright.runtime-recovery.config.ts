import { defineConfig, devices } from '@playwright/test';

const RUNTIME_RECOVERY_RELEASE_SHA = 'c'.repeat(40);

export default defineConfig({
  testDir: './e2e-runtime-recovery',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4193',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium-runtime-recovery',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: 'pnpm --filter @raspi-system/web build && pnpm --filter @raspi-system/web preview --host 127.0.0.1 --port 4193 --strictPort',
    port: 4193,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      VITE_RELEASE_SHA: RUNTIME_RECOVERY_RELEASE_SHA,
      VITE_API_BASE_URL: '/api',
      VITE_WS_BASE_URL: 'ws://127.0.0.1:4193/ws',
      VITE_DEFAULT_CLIENT_KEY: 'client-key-runtime-recovery-e2e'
    }
  }
});
