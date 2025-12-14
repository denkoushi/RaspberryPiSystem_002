import { test, expect } from '@playwright/test';

test.describe('キオスク画面スモーク', () => {
  test('初期表示でキオスク端末にリダイレクトされる', async ({ page }) => {
    await page.goto('/kiosk');
    await expect(page.getByText(/キオスク端末/i)).toBeVisible({ timeout: 5000 });
    // defaultMode（tag/photo）いずれでも /kiosk/* に遷移していることを確認
    await expect(page).toHaveURL(/\/kiosk(\/tag|\/photo)?/);
    await expect(page.locator('a[href="/kiosk"]').filter({ hasText: '持出' }).first()).toBeVisible();
    await expect(page.locator('a[href="/kiosk/rigging/borrow"]').filter({ hasText: '吊具 持出' }).first()).toBeVisible();
  });

  test('ナビゲーションで持出⇔吊具持出を行き来できる', async ({ page }) => {
    await page.goto('/kiosk/tag');
    const riggingLink = page.locator('a[href="/kiosk/rigging/borrow"]').filter({ hasText: '吊具 持出' }).first();
    await riggingLink.waitFor({ state: 'visible' });
    await riggingLink.click();
    await expect(page).toHaveURL(/\/kiosk\/rigging\/borrow/);

    // 持出に戻れることを確認（/kiosk に遷移し、KioskRedirectがdefaultModeに従い再遷移）
    const borrowLink = page.locator('a[href="/kiosk"]').filter({ hasText: '持出' }).first();
    await borrowLink.waitFor({ state: 'visible' });
    await borrowLink.click();
    await expect(page).toHaveURL(/\/kiosk(\/tag|\/photo)?/);
  });
});

