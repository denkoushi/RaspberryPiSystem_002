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
    // ページが読み込まれるまで待機
    await page.waitForLoadState('networkidle');
    // Cardコンポーネントの見出しを確認（「従業員登録 / 編集」または「従業員一覧」）
    // 複数の見出しがあるため、.first()を使用
    await expect(page.getByRole('heading', { name: /従業員/i }).first()).toBeVisible();
  });

  test('アイテム管理画面にアクセスできる', async ({ page }) => {
    await page.getByRole('link', { name: /アイテム/i }).click();
    await expect(page).toHaveURL(/\/admin\/tools\/items/);
    // ページが読み込まれるまで待機
    await page.waitForLoadState('networkidle');
    // Cardコンポーネントの見出しを確認（「アイテム登録 / 編集」または「アイテム一覧」）
    // 複数の見出しがあるため、.first()を使用
    await expect(page.getByRole('heading', { name: /アイテム/i }).first()).toBeVisible();
  });

  test('履歴画面にアクセスできる', async ({ page }) => {
    await page.getByRole('link', { name: /履歴/i }).click();
    await expect(page).toHaveURL(/\/admin\/tools\/history/);
    // ページが読み込まれるまで待機
    await page.waitForLoadState('networkidle');
    // Cardコンポーネントの見出しを確認
    await expect(page.getByRole('heading', { name: /履歴/i })).toBeVisible();
  });

  test.describe('バックアップ対象管理', () => {
    test('バックアップ対象管理画面にアクセスできる', async ({ page }) => {
      await page.getByRole('link', { name: /バックアップ/i }).click();
      await expect(page).toHaveURL(/\/admin\/backup\/targets/);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('heading', { name: /バックアップ対象管理/i })).toBeVisible();
    });

    test('バックアップ対象を追加できる', async ({ page }) => {
      await page.goto('/admin/backup/targets');
      await page.waitForLoadState('networkidle');

      // 「追加」ボタンをクリック
      await page.getByRole('button', { name: /追加/i }).click();

      // フォームに入力
      await page.getByLabel(/種類/i).selectOption('file');
      await page.getByLabel(/ソース/i).fill('/tmp/test-backup-file.txt');
      await page.getByLabel(/スケジュール/i).fill('0 3 * * *');
      
      // 「保存」ボタンをクリック
      await page.getByRole('button', { name: /保存/i }).click();

      // 一覧に新しい対象が表示されることを確認
      await expect(page.getByText('/tmp/test-backup-file.txt')).toBeVisible({ timeout: 5000 });
    });

    test('バックアップ対象の有効/無効を切り替えられる', async ({ page }) => {
      await page.goto('/admin/backup/targets');
      await page.waitForLoadState('networkidle');

      // 最初のチェックボックスを取得
      const firstCheckbox = page.locator('input[type="checkbox"]').first();
      const initialChecked = await firstCheckbox.isChecked();

      // チェックボックスをクリック
      await firstCheckbox.click();

      // 状態が変更されたことを確認
      await expect(firstCheckbox).toHaveProperty('checked', !initialChecked, { timeout: 3000 });
    });

    test('バックアップ対象を削除できる', async ({ page }) => {
      await page.goto('/admin/backup/targets');
      await page.waitForLoadState('networkidle');

      // 最初の「削除」ボタンをクリック
      const deleteButtons = page.getByRole('button', { name: /削除/i });
      const deleteButtonCount = await deleteButtons.count();
      
      if (deleteButtonCount > 0) {
        // 確認ダイアログを自動承認
        page.on('dialog', dialog => dialog.accept());
        
        await deleteButtons.first().click();
        
        // 削除が完了するまで待機
        await page.waitForTimeout(1000);
        
        // 削除ボタンの数が減ったことを確認
        const newDeleteButtonCount = await page.getByRole('button', { name: /削除/i }).count();
        expect(newDeleteButtonCount).toBeLessThan(deleteButtonCount);
      }
    });
  });
});

