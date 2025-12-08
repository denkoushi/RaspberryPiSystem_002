import { test, expect } from '@playwright/test';

test.describe('キオスク画面スモーク', () => {
  test('持出画面が表示され、ナビゲーションが見える', async ({ page }) => {
    await page.goto('/kiosk');
    await expect(page.getByText(/キオスク端末/i)).toBeVisible({ timeout: 5000 });
    // href属性で直接特定（計測機器のリンクと区別）
    await expect(page.locator('a[href="/kiosk"]').filter({ hasText: '持出' }).first()).toBeVisible();
    await expect(page.locator('a[href="/kiosk/return"]').filter({ hasText: '返却' }).first()).toBeVisible();
  });

  test('返却画面が表示される', async ({ page }) => {
    await page.goto('/kiosk/return');
    await expect(page.getByText(/キオスク端末/i)).toBeVisible({ timeout: 5000 });
    // href属性で直接特定
    await expect(page.locator('a[href="/kiosk/return"]').filter({ hasText: '返却' }).first()).toBeVisible();
  });

  test('持出↔返却のナビゲーションが動作する', async ({ page }) => {
    await page.goto('/kiosk');
    // href属性で直接特定（計測機器のリンクと区別）
    const returnLink = page.locator('a[href="/kiosk/return"]').filter({ hasText: '返却' }).first();
    await returnLink.waitFor({ state: 'visible' });
    await returnLink.click();
    await expect(page).toHaveURL(/\/kiosk\/return/);

    // href属性で直接特定（持出リンクは複数あるのでfirst()で最初のものを取得）
    const borrowLink = page.locator('a[href="/kiosk"]').filter({ hasText: '持出' }).first();
    await borrowLink.waitFor({ state: 'visible' });
    await borrowLink.click();
    await expect(page).toHaveURL(/\/kiosk$/);
  });
});

