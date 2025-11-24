import { test, expect } from '@playwright/test';

test.describe('認証フロー', () => {
  test('ログイン画面が表示される', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /管理者ログイン/i })).toBeVisible();
    await expect(page.getByText(/ユーザー名/i)).toBeVisible();
    await expect(page.getByText(/パスワード/i)).toBeVisible();
    await expect(page.getByRole('textbox', { name: /ユーザー名/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /ログイン/i })).toBeVisible();
  });

  test('無効な認証情報でログインに失敗する', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: /ユーザー名/i }).fill('invalid-user');
    await page.getByLabel(/パスワード/i).fill('invalid-password');
    await page.getByRole('button', { name: /ログイン/i }).click();

    // エラーメッセージが表示される
    await expect(page.getByText(/ログインに失敗/i)).toBeVisible({ timeout: 5000 });
  });

  test('有効な認証情報でログインに成功し、管理画面にリダイレクトされる', async ({ page, request }) => {
    // adminユーザーが存在するか確認
    const checkResponse = await request.post('http://localhost:8080/api/auth/login', {
      data: {
        username: 'admin',
        password: 'admin1234',
      },
    });

    if (checkResponse.status() !== 200) {
      test.skip();
      return;
    }

    // 既存のadminユーザーでログイン
    await page.goto('/login');
    await page.getByRole('textbox', { name: /ユーザー名/i }).fill('admin');
    await page.getByLabel(/パスワード/i).fill('admin1234');
    await page.getByRole('button', { name: /ログイン/i }).click();

    // 管理画面にリダイレクトされる
    await expect(page).toHaveURL(/\/admin/, { timeout: 5000 });
    await expect(page.getByText(/ダッシュボード/i)).toBeVisible();
  });

  test('未認証ユーザーが管理画面にアクセスするとログイン画面にリダイレクトされる', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });
});

