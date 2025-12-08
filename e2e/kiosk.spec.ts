import { test, expect } from '@playwright/test';

test.describe('キオスク画面', () => {
  test('キオスク持出画面が表示される', async ({ page }) => {
    await page.goto('/kiosk');
    await expect(page.getByText(/キオスク端末/i)).toBeVisible();
    // ナビゲーションリンクを確認（href属性とテキストで特定）
    await expect(page.locator('a[href="/kiosk"]').filter({ hasText: '持出' }).first()).toBeVisible();
    await expect(page.locator('a[href="/kiosk/return"]').filter({ hasText: '返却' }).first()).toBeVisible();
  });

  test('キオスク返却画面が表示される', async ({ page }) => {
    await page.goto('/kiosk/return');
    await expect(page.getByText(/キオスク端末/i)).toBeVisible();
    // ナビゲーションリンクを確認（href属性とテキストで特定）
    await expect(page.locator('a[href="/kiosk/return"]').filter({ hasText: '返却' }).first()).toBeVisible();
  });

  test('持出と返却のナビゲーションが動作する', async ({ page }) => {
    await page.goto('/kiosk');
    
    // 返却タブをクリック
    const returnLink = page.locator('a[href="/kiosk/return"]').filter({ hasText: '返却' }).first();
    await returnLink.click();
    await expect(page).toHaveURL(/\/kiosk\/return/);

    // 持出タブをクリック
    const borrowLink = page.locator('a[href="/kiosk"]').filter({ hasText: '持出' }).first();
    await borrowLink.click();
    await expect(page).toHaveURL(/\/kiosk$/);
  });

  // 注意: NFCスキャンのE2EテストはCI環境では実行しない
  // 理由:
  // 1. CI環境には物理的なNFCリーダーが存在しない
  // 2. WebSocketをモックしても、実際のハードウェア統合をテストできない
  // 3. 状態マシンのロジックは既にborrowMachine.test.tsでユニットテストされている
  // 4. APIの統合テストは既にloans.integration.test.tsで実施されている
  //
  // NFCスキャンの実際の動作は、以下の環境でテストすべき:
  // - ローカル環境（物理デバイスがある場合）
  // - ステージング環境（実際のハードウェア統合テスト）
});

