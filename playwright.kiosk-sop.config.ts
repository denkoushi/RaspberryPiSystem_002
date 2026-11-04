import { defineConfig, devices } from '@playwright/test';

const externalBaseURL = process.env.KIOSK_SOP_BASE_URL;
const localBaseURL = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'inspection-drawing-sop-popup.spec.ts',
  // Every test sets up its own page, mocks and viewport, so the local dev-server run
  // (CI kiosk-sop job) spreads them over 2 workers. The production-bundle check
  // (KIOSK_SOP_BASE_URL) stays serial on the deploy host.
  fullyParallel: !externalBaseURL,
  forbidOnly: true,
  retries: 0,
  workers: externalBaseURL ? 1 : 2,
  globalSetup: externalBaseURL ? undefined : './scripts/kiosk-sop/playwright-dev-server-warmup.mjs',
  reporter: 'line',
  use: {
    baseURL: externalBaseURL ?? localBaseURL,
    // retries is 0, so keep the trace of the failing run itself; a stalled action
    // fails on its own instead of silently consuming the whole test timeout.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000
  },
  projects: [
    // Every production kiosk runs Chromium; Firefox is not a target any more.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: externalBaseURL ? undefined : {
    command: 'pnpm --filter @raspi-system/web dev --host 127.0.0.1 --port 4173',
    url: localBaseURL,
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
