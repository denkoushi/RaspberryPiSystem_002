import { test, expect } from '@playwright/test';

import { clickByRoleSafe, closeDialogWithEscape } from './helpers';

test.describe('キオスク画面', () => {
  test('キオスク初期表示でヘッダーとナビゲーションが見える', async ({ page }) => {
    await page.goto('/kiosk');
    await expect(page.getByText(/キオスク端末/i)).toBeVisible();
    // defaultMode により /kiosk/tag または /kiosk/photo へ遷移するが、ヘッダーナビは共通
    await expect(page).toHaveURL(/\/kiosk(\/tag|\/photo)?/);
    await expect(page.locator('a[href="/kiosk"]').filter({ hasText: '持出' }).first()).toBeVisible();
    await expect(page.locator('a[href="/kiosk/rigging/borrow"]').filter({ hasText: '吊具 持出' }).first()).toBeVisible();
  });

  test('持出と吊具持出のナビゲーションが動作する', async ({ page }) => {
    await page.goto('/kiosk/tag', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/kiosk\/tag/);

    // 吊具持出へ遷移
    const riggingLink = page.getByRole('link', { name: '吊具 持出' }).first();
    await riggingLink.waitFor({ state: 'visible' });
    await riggingLink.scrollIntoViewIfNeeded();
    await riggingLink.click();
    await expect(page).toHaveURL(/\/kiosk\/rigging\/borrow/);

    // 持出（タグまたはフォト）へ戻れることを確認
    const borrowLink = page.getByRole('link', { name: '持出' }).first();
    await borrowLink.waitFor({ state: 'visible' });
    await borrowLink.scrollIntoViewIfNeeded();
    await borrowLink.click();
    await expect(page).toHaveURL(/\/kiosk(\/tag|\/photo)?/);
  });

  test('サイネージプレビューと電源メニューのモーダルが開閉できる', async ({ page }) => {
    // KioskRedirectを避けるため、直接/kiosk/tagにアクセス
    await page.goto('/kiosk/tag', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/kiosk\/tag/);
    
    // ヘッダーが表示されるまで待つ
    await expect(page.getByText(/キオスク端末/i)).toBeVisible();

    // サイネージボタンをクリックしてモーダルを開く
    const signageButton = page.getByRole('button', { name: 'サイネージ' });
    await signageButton.waitFor({ state: 'visible' });
    await signageButton.scrollIntoViewIfNeeded();
    await signageButton.click();
    await expect(page.getByText('サイネージプレビュー')).toBeVisible({ timeout: 10000 });
    
    // モーダルを閉じる
    await closeDialogWithEscape(page);
    await expect(page.getByText('サイネージプレビュー')).toBeHidden({ timeout: 5000 });

    // 電源メニューを開く
    const powerButton = page.getByLabel('電源メニュー');
    await powerButton.waitFor({ state: 'visible' });
    await powerButton.scrollIntoViewIfNeeded();
    await powerButton.click();
    await expect(page.getByRole('button', { name: '再起動' })).toBeVisible({ timeout: 10000 });
    
    // 再起動を選択して確認モーダルを開く
    await page.getByRole('button', { name: '再起動' }).click();
    await expect(page.getByText('端末を再起動しますか？')).toBeVisible({ timeout: 10000 });
    
    // 確認モーダルをキャンセル
    await clickByRoleSafe(page, 'button', 'キャンセル');
    await expect(page.getByText('端末を再起動しますか？')).toBeHidden({ timeout: 5000 });
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

