import { test, expect } from '@playwright/test';

import {
  assertBandFitsWithinWidth,
  assertBandHeightWithinTwoRows,
  assertNoOrphanInspectionCountChip,
  countBandVisualRows,
  mockKioskLayoutApis
} from './helpers/inspectionDrawingCreateHeaderLayout';

const scenarios = ['revise', 'fixed_count', 'create_new'] as const;

test.describe('検査図面作成ヘッダー フラット band レイアウト', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      window.localStorage.setItem('kiosk-client-key', JSON.stringify('client-key-raspberrypi4-kiosk1'));
    });
    await mockKioskLayoutApis(page);
  });

  for (const scenario of scenarios) {
    test(`${scenario}: 1280px で最大2行・孤児 chip なし・横溢れなし`, async ({ page }) => {
      await page.goto(`/dev/kiosk-inspection-drawing-create?scenario=${scenario}`, {
        waitUntil: 'networkidle'
      });

      await expect(page.getByTestId('inspection-drawing-create-header-band')).toBeVisible();

      const rowCount = await countBandVisualRows(page);
      expect(rowCount).toBeLessThanOrEqual(2);

      await assertNoOrphanInspectionCountChip(page);
      await assertBandFitsWithinWidth(page);
      await assertBandHeightWithinTwoRows(page);
    });
  }
});
