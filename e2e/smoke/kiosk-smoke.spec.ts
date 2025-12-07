import { test, expect } from '@playwright/test';

test.describe('キオスク画面スモーク', () => {
  test('持出画面が表示され、ナビゲーションが見える', async ({ page }) => {
    await page.goto('/kiosk');
    await expect(page.getByText(/キオスク端末/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('link', { name: /持出/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /返却/i })).toBeVisible();
  });

  test('返却画面が表示される', async ({ page }) => {
    await page.goto('/kiosk/return');
    await expect(page.getByText(/キオスク端末/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('link', { name: /返却/i })).toBeVisible();
  });

  test('持出↔返却のナビゲーションが動作する', async ({ page }) => {
    await page.goto('/kiosk');
    const returnLink = page.getByRole('link', { name: /返却/i });
    await returnLink.waitFor({ state: 'visible' });
    await returnLink.click();
    await expect(page).toHaveURL(/\/kiosk\/return/);

    const borrowLink = page.getByRole('link', { name: /持出/i });
    await borrowLink.waitFor({ state: 'visible' });
    await borrowLink.click();
    await expect(page).toHaveURL(/\/kiosk$/);
  });
});

