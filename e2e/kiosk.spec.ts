import { test, expect } from '@playwright/test';
import { login, createTestEmployee, createTestItem } from './helpers';

test.describe('キオスク画面', () => {
  test('キオスク持出画面が表示される', async ({ page }) => {
    await page.goto('/kiosk');
    await expect(page.getByText(/キオスク端末/i)).toBeVisible();
    // ナビゲーションリンクを確認
    await expect(page.getByRole('link', { name: /持出/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /返却/i })).toBeVisible();
  });

  test('キオスク返却画面が表示される', async ({ page }) => {
    await page.goto('/kiosk/return');
    await expect(page.getByText(/キオスク端末/i)).toBeVisible();
    // ナビゲーションリンクを確認
    await expect(page.getByRole('link', { name: /返却/i })).toBeVisible();
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

  test('NFCスキャンで持出が成功する', async ({ page, request }) => {
    // テスト用のトークンを取得
    const token = await login(request, 'admin', 'admin1234');

    // テスト用の従業員とアイテムを作成
    const itemTagUid = `TAG_ITEM_${Date.now()}`;
    const employeeTagUid = `TAG_EMP_${Date.now()}`;

    await createTestItem(request, token, {
      itemCode: `ITEM_${Date.now()}`,
      name: 'テストアイテム',
      nfcTagUid: itemTagUid,
    });

    await createTestEmployee(request, token, {
      employeeCode: `EMP_${Date.now()}`,
      displayName: 'テスト従業員',
      nfcTagUid: employeeTagUid,
    });

    // WebSocketをモックしてNFCイベントをシミュレート
    await page.addInitScript(({ itemTagUid, employeeTagUid }) => {
      // WebSocketをモック
      const originalWebSocket = window.WebSocket;
      let mockSocket: any = null;
      let messageQueue: Array<{ uid: string; timestamp: string }> = [];

      window.WebSocket = class extends originalWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          mockSocket = this;
          // 接続をシミュレート
          setTimeout(() => {
            if (this.onopen) {
              this.onopen(new Event('open') as any);
            }
            // アイテムタグをスキャン
            setTimeout(() => {
              if (this.onmessage) {
                this.onmessage({
                  data: JSON.stringify({ uid: itemTagUid, timestamp: new Date().toISOString() }),
                } as MessageEvent);
              }
            }, 100);
            // 従業員タグをスキャン
            setTimeout(() => {
              if (this.onmessage) {
                this.onmessage({
                  data: JSON.stringify({ uid: employeeTagUid, timestamp: new Date().toISOString() }),
                } as MessageEvent);
              }
            }, 600);
          }, 50);
        }
      } as any;
    }, { itemTagUid, employeeTagUid });

    // キオスク画面に移動
    await page.goto('/kiosk');
    await expect(page.getByText(/キオスク端末/i)).toBeVisible();

    // 持出が成功するまで待機（最大10秒）
    // アイテムタグが表示されることを確認
    await expect(page.getByText(itemTagUid)).toBeVisible({ timeout: 5000 });
    // 従業員タグが表示されることを確認
    await expect(page.getByText(employeeTagUid)).toBeVisible({ timeout: 5000 });
    // 登録完了メッセージが表示されることを確認
    await expect(page.getByText(/登録完了/i)).toBeVisible({ timeout: 10000 });
  });
});

