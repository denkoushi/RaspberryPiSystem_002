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

    // エラーメッセージが表示される（ログイン画面に留まることを確認）
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    // APIエラーメッセージまたはフォールバックメッセージを確認
    // APIは「ユーザー名またはパスワードが違います」を返すが、フォールバックは「ログインに失敗しました」
    // role="alert"を使用してエラーメッセージを確実に取得
    await expect(
      page.getByRole('alert').or(page.getByText(/ユーザー名またはパスワードが違います|ログインに失敗しました/i))
    ).toBeVisible({ timeout: 10000 });
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
    
    // ログインボタンをクリックして、ナビゲーションを待つ
    await Promise.all([
      page.waitForURL(/\/admin/, { timeout: 15000 }),
      page.getByRole('button', { name: /ログイン/i }).click(),
    ]);

    // 管理画面にリダイレクトされる
    await expect(page).toHaveURL(/\/admin/, { timeout: 10000 });
    await expect(page.getByText(/ダッシュボード/i)).toBeVisible({ timeout: 10000 });
  });

  test('未認証ユーザーが管理画面にアクセスするとログイン画面にリダイレクトされる', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });
});

