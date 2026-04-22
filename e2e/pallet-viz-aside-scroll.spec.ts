import { test, expect } from '@playwright/test';

function buildBoard(machineCount: number) {
  const machines = Array.from({ length: machineCount }, (_, i) => ({
    machineCd: `CD${String(i + 1).padStart(3, '0')}`,
    machineName: `加工機 ${i + 1} 番`,
    illustrationUrl: null as string | null,
    pallets: Array.from({ length: 10 }, (_, p) => ({ palletNo: p + 1, items: [] as unknown[] })),
  }));
  return { machines };
}

test.describe('パレット可視化 左ペインスクロール', () => {
  test('LG 幅で加工機リストが aside 内でスクロール可能（レイアウト計測）', async ({ page }) => {
    await page.route('**/api/system/deploy-status', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ isMaintenance: false }) })
    );
    await page.route('**/api/kiosk/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          theme: 'dark',
          greeting: '',
          idleTimeoutMs: 30_000,
          defaultMode: 'TAG',
          clientStatus: null,
        }),
      })
    );
    await page.route('**/api/kiosk/call/targets', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ selfClientId: 'e2e-client', targets: [] }),
      })
    );
    await page.route('**/api/kiosk/pallet-visualization/board', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildBoard(42)),
      })
    );

    await page.setViewportSize({ width: 1400, height: 700 });
    await page.goto('/kiosk/pallet-visualization', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'パレット可視化' })).toBeVisible();
    await page.waitForTimeout(800);

    const metrics = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      const mains = [...document.querySelectorAll('main')];
      const kioskMain = mains[mains.length - 1];
      return {
        aside: aside
          ? {
              scrollHeight: aside.scrollHeight,
              clientHeight: aside.clientHeight,
              canScroll: aside.scrollHeight > aside.clientHeight,
            }
          : null,
        kioskMain: kioskMain
          ? {
              scrollHeight: kioskMain.scrollHeight,
              clientHeight: kioskMain.clientHeight,
              canScroll: kioskMain.scrollHeight > kioskMain.clientHeight,
              overflowY: getComputedStyle(kioskMain).overflowY,
            }
          : null,
      };
    });

    expect(metrics.aside, 'aside が存在する').toBeTruthy();
    expect(metrics.aside!.canScroll, `aside がスクロール可能であること: ${JSON.stringify(metrics)}`).toBe(true);
  });
});
