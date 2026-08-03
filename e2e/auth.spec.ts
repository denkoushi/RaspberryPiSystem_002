import { test, expect } from '@playwright/test';

const e2eAdminUsername = process.env.E2E_ADMIN_USERNAME;
const e2eAdminPassword = process.env.E2E_ADMIN_PASSWORD;

function requireE2eAdminCredentials(): { username: string; password: string } {
  if (!e2eAdminUsername || !e2eAdminPassword) {
    throw new Error('E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD are required for authentication E2E tests');
  }
  return { username: e2eAdminUsername, password: e2eAdminPassword };
}

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

  test('有効な認証情報でログインに成功し、管理画面にリダイレクトされる', async ({ page }) => {
    const credentials = requireE2eAdminCredentials();
    await page.goto('/login');
    await page.getByRole('textbox', { name: /ユーザー名/i }).fill(credentials.username);
    await page.getByLabel(/パスワード/i).fill(credentials.password);

    const loginResponsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: /ログイン/i }).click();
    expect((await loginResponsePromise).ok()).toBe(true);

    await expect(page).toHaveURL(/\/admin/, { timeout: 10000 });
    await expect(page.getByText(credentials.username, { exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('未認証ユーザーが管理画面にアクセスするとログイン画面にリダイレクトされる', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });
});
