import { chromium } from '@playwright/test';

// Vite dev transforms modules on first request. With parallel workers, the first
// test on every worker would otherwise pay that cold cost at the same moment
// (KB-436). Load the spec's route once here, after webServer is up and before
// any worker starts. API calls are answered locally; the page content is unused.
export default async function warmUpKioskSopDevServer(config) {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({ status: 404, json: {} }));
    await page.goto(new URL('/kiosk/part-measurement/inspection', baseURL).href, { waitUntil: 'load', timeout: 180_000 });
    await page.waitForLoadState('networkidle', { timeout: 180_000 });
  } finally {
    await browser.close();
  }
}
