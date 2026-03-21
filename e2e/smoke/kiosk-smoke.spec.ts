import { test, expect, type Page } from '@playwright/test';

/**
 * 沉浸式キオスク（上端ヘッダー既定非表示）ではナビがビューポート外になり得る。
 * `useKioskTopEdgeHeaderReveal` と同様に上端へマウスを移してヘッダーを表示する。
 */
async function revealKioskHeader(page: Page): Promise<void> {
  const size = page.viewportSize();
  if (!size) return;
  await page.mouse.move(size.width / 2, 2);
  await page.waitForFunction(
    () => {
      const h = document.querySelector('header');
      if (!h) return true;
      const rect = h.getBoundingClientRect();
      return rect.bottom > 8 && rect.top >= -2;
    },
    { timeout: 5000 }
  );
  await page.waitForTimeout(250);
}

test.describe('キオスク画面スモーク', () => {
  test('初期表示でキオスク端末にリダイレクトされる', async ({ page }) => {
    await page.goto('/kiosk');
    await expect(page.getByText(/キオスク端末/i)).toBeVisible({ timeout: 5000 });
    // defaultMode（tag/photo）いずれでも /kiosk/* に遷移していることを確認
    await expect(page).toHaveURL(/\/kiosk(\/tag|\/photo)?/);
    await revealKioskHeader(page);
    await expect(page.locator('a[href="/kiosk"]').filter({ hasText: '持出' }).first()).toBeVisible();
    await expect(page.locator('a[href="/kiosk/rigging/borrow"]').filter({ hasText: '吊具 持出' }).first()).toBeVisible();
  });

  test('ナビゲーションで持出⇔吊具持出を行き来できる', async ({ page }) => {
    await page.goto('/kiosk/tag', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/kiosk\/tag/);
    await revealKioskHeader(page);
    const riggingLink = page.getByRole('link', { name: '吊具 持出' }).first();
    await riggingLink.waitFor({ state: 'visible' });
    await riggingLink.scrollIntoViewIfNeeded();
    await riggingLink.click();
    await expect(page).toHaveURL(/\/kiosk\/rigging\/borrow/);

    // 持出に戻れることを確認（/kiosk に遷移し、KioskRedirectがdefaultModeに従い再遷移）
    await revealKioskHeader(page);
    const borrowLink = page.getByRole('link', { name: '持出' }).first();
    await borrowLink.waitFor({ state: 'visible' });
    await borrowLink.scrollIntoViewIfNeeded();
    await borrowLink.click();
    await expect(page).toHaveURL(/\/kiosk(\/tag|\/photo)?/);
  });
});

