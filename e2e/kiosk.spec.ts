import { test, expect } from '@playwright/test';

test.describe('キオスク画面', () => {
  test('キオスク持出画面が表示される', async ({ page }) => {
    await page.goto('/kiosk');
    await expect(page.getByText(/キオスク端末/i)).toBeVisible();
    await expect(page.getByText(/持出/i)).toBeVisible();
    await expect(page.getByText(/返却/i)).toBeVisible();
  });

  test('キオスク返却画面が表示される', async ({ page }) => {
    await page.goto('/kiosk/return');
    await expect(page.getByText(/キオスク端末/i)).toBeVisible();
    await expect(page.getByText(/返却/i)).toBeVisible();
  });

  test('持出と返却のナビゲーションが動作する', async ({ page }) => {
    await page.goto('/kiosk');
    
    // 返却タブをクリック
    await page.getByRole('link', { name: /返却/i }).click();
    await expect(page).toHaveURL(/\/kiosk\/return/);

    // 持出タブをクリック
    await page.getByRole('link', { name: /持出/i }).click();
    await expect(page).toHaveURL(/\/kiosk$/);
  });
});

