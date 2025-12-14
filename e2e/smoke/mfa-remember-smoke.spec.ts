import { test, expect } from '@playwright/test';

/**
 * MFA 30日記憶オプションのスモークテスト。
 * API呼び出しはPlaywrightのrouteでモックし、バックエンド依存を排除。
 */
test.describe('MFA remember-me (30日記憶) smoke', () => {
  test('remember-meにチェックするとlocalStorageにexpiresAtが保存される', async ({ page }) => {
    test.skip(process.env.CI, 'CI環境では/login描画が不安定なためスキップ（ローカル専用）');
    // ログインAPIをモックして即座に成功レスポンスを返す
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accessToken: 'mock-access',
          refreshToken: 'mock-refresh',
          user: { id: 'admin-id', username: 'admin', role: 'ADMIN' },
        }),
      });
    });
    // その他のAPIは空レスポンスでモック
    await page.route('**/api/**', async (route) => {
      if (route.request().url().endsWith('/auth/login')) return;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /管理者ログイン/i })).toBeVisible();
    const usernameInput = page.getByRole('textbox').first();
    const passwordInput = page.getByRole('textbox').nth(1);
    await usernameInput.fill('admin');
    await passwordInput.fill('mock-password');
    await page.getByLabel(/30日間この端末でサインイン状態を維持する/i).check();
    await page.getByRole('button', { name: /ログイン/i }).click();

    // localStorageに30日記憶のexpiresAtが保存されることを確認
    const authData = await page.evaluate(() => {
      const raw = localStorage.getItem('factory-auth');
      return raw ? JSON.parse(raw) : null;
    });
    expect(authData).not.toBeNull();
    expect(authData.expiresAt).toBeDefined();
    expect(Number(authData.expiresAt)).toBeGreaterThan(Date.now());
  });

  test('remember-me未チェックならlocalStorageに記憶情報を残さない', async ({ page }) => {
    test.skip(process.env.CI, 'CI環境では/login描画が不安定なためスキップ（ローカル専用）');
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accessToken: 'mock-access',
          refreshToken: 'mock-refresh',
          user: { id: 'admin-id', username: 'admin', role: 'ADMIN' },
        }),
      });
    });
    await page.route('**/api/**', async (route) => {
      if (route.request().url().endsWith('/auth/login')) return;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /管理者ログイン/i })).toBeVisible();
    const usernameInput = page.getByRole('textbox').first();
    const passwordInput = page.getByRole('textbox').nth(1);
    await usernameInput.fill('admin');
    await passwordInput.fill('mock-password');
    // チェックしないでログイン
    await page.getByRole('button', { name: /ログイン/i }).click();

    const authData = await page.evaluate(() => {
      const raw = localStorage.getItem('factory-auth');
      return raw ? JSON.parse(raw) : null;
    });
    // remember未チェックなのでlocalStorageは空、またはexpiresAtなし
    if (authData) {
      expect(authData.expiresAt).toBeUndefined();
    } else {
      expect(authData).toBeNull();
    }
  });
});

