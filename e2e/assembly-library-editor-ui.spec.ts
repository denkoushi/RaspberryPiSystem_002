import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 }
] as const;

async function mockKioskApis(page: Page, deployNotice = false): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/src/api/')) {
      await route.continue();
      return;
    }
    if (path.includes('/system/deploy-status/ack')) {
      await route.fulfill({
        json: {
          acknowledged: true,
          scheduledAt: new Date(Date.now() + 60_000).toISOString()
        }
      });
      return;
    }
    if (path.includes('/system/deploy-status')) {
      await route.fulfill({
        json: deployNotice
          ? {
              isMaintenance: false,
              runId: 'assembly-ui-e2e',
              preNotice: { scheduledAt: new Date(Date.now() + 60_000).toISOString() }
            }
          : { isMaintenance: false }
      });
      return;
    }
    if (path.includes('/kiosk/config')) {
      await route.fulfill({ json: { defaultMode: 'tag', clientStatus: null } });
      return;
    }
    if (path.includes('/kiosk/call/targets')) {
      await route.fulfill({ json: { selfClientId: 'assembly-ui-e2e', targets: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

for (const viewport of viewports) {
  test(`assembly library is two-row and deploy notice stays movable/non-blocking at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockKioskApis(page, true);
    await page.goto('/dev/kiosk-assembly-library', { waitUntil: 'networkidle' });

    const procedureTable = page.getByRole('table', { name: '手順書ライブラリ' });
    await expect(procedureTable).toBeVisible();
    await expect(procedureTable.locator('tbody tr')).toHaveCount(4);
    await expect(page.locator('th', { hasText: '型番' }).first()).toBeVisible();

    const combo = page.getByRole('combobox', { name: '手順書名で検索' });
    await combo.click();
    await page.getByRole('option', { name: 'CSPBTLD ストッパー取付 手順書' }).click();
    await expect(combo).toHaveValue('CSPBTLD ストッパー取付 手順書');

    const notice = page.getByTestId('kiosk-deploy-pre-notice');
    await expect(notice).toBeVisible();
    const beforeTransform = await notice.evaluate((element) => (element as HTMLElement).style.transform);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => notice.evaluate((element) => (element as HTMLElement).style.transform))
      .not.toBe(beforeTransform);

    await page.getByRole('button', { name: '登録' }).click();
    await expect(page.getByRole('dialog', { name: '手順書を登録' })).toBeVisible();
  });

  test(`assembly editor zooms, fits, places markers, and renders bolt/check callouts at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockKioskApis(page);
    await page.goto('/dev/kiosk-assembly-template-editor', { waitUntil: 'networkidle' });

    const canvas = page.getByTestId('assembly-procedure-canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas.locator('svg line')).toHaveCount(2);
    await expect(canvas.locator('button[title^="P7-A13"]')).toHaveCount(2);

    for (let index = 0; index < 6; index += 1) {
      await page.getByRole('button', { name: '拡大' }).click();
    }
    await expect.poll(() => canvas.evaluate((element) => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight))
      .toBe(true);

    await page.getByRole('button', { name: '全面表示' }).click();
    await expect.poll(() => canvas.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop })))
      .toEqual({ left: 0, top: 0 });

    const image = canvas.locator('img').last();
    const box = await image.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width * 0.88, box!.y + box!.height * 0.86);
    await expect(canvas.locator('button[title^="P7-A13"]')).toHaveCount(3);
  });
}
