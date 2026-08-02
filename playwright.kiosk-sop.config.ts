import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'inspection-drawing-sop-popup.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } }
  ],
  webServer: {
    command: 'pnpm --filter @raspi-system/web dev --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 180000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      VITE_KIOSK_SOP_POPUP_ENABLED: 'true',
      VITE_DEFAULT_CLIENT_KEY: 'client-key-raspberrypi4-kiosk1'
    }
  }
});
