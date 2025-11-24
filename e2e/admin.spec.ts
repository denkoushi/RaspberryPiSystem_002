import { test, expect } from '@playwright/test';
import { login, setAuthToken } from './helpers';

test.describe('管理画面', () => {
  let authToken: string | null = null;

  test.beforeAll(async ({ request }) => {
    // adminユーザーでログインを試みる
    try {
      authToken = await login(request, 'admin', 'admin1234');
      // ユーザー情報も取得
      const loginResponse = await request.post('http://localhost:8080/api/auth/login', {
        data: { username: 'admin', password: 'admin1234' },
      });
      if (loginResponse.ok()) {
        const body = await loginResponse.json();
        authToken = body.accessToken;
      }
    } catch {
      // adminユーザーが存在しない場合はスキップ
      test.skip();
    }
  });

  test.beforeEach(async ({ page }) => {
    if (!authToken) {
      test.skip();
    }
    
    // トークンを設定して管理画面にアクセス
    await setAuthToken(page, authToken!, { id: 'test-id', username: 'admin', role: 'ADMIN' });
    await page.goto('/admin');
    // ページが読み込まれるまで待機
    await page.waitForLoadState('networkidle');
  });

  test('ダッシュボードが表示される', async ({ page }) => {
    // ダッシュボードのナビゲーションリンクまたはカードが表示されることを確認
    await expect(page.getByRole('link', { name: /ダッシュボード/i })).toBeVisible();
    // カードが表示されることを確認（従業員、アイテム、貸出中）
    // ダッシュボードのカード内の見出しを確認
    await expect(page.getByRole('heading', { name: /従業員/i })).toBeVisible({ timeout: 10000 });
  });

  test('従業員管理画面にアクセスできる', async ({ page }) => {
    await page.getByRole('link', { name: /従業員/i }).click();
    await expect(page).toHaveURL(/\/admin\/tools\/employees/);
    await expect(page.getByText(/従業員管理/i)).toBeVisible();
  });

  test('アイテム管理画面にアクセスできる', async ({ page }) => {
    await page.getByRole('link', { name: /アイテム/i }).click();
    await expect(page).toHaveURL(/\/admin\/tools\/items/);
    await expect(page.getByText(/アイテム管理/i)).toBeVisible();
  });

  test('履歴画面にアクセスできる', async ({ page }) => {
    await page.getByRole('link', { name: /履歴/i }).click();
    await expect(page).toHaveURL(/\/admin\/tools\/history/);
    await expect(page.getByText(/履歴/i)).toBeVisible();
  });
});

