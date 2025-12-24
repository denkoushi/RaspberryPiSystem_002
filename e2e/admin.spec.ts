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

      // フォームが表示されるまで待機
      await expect(page.getByLabel(/種類/i)).toBeVisible({ timeout: 3000 });

      // フォームに入力
      await page.getByLabel(/種類/i).selectOption('file');
      await page.getByLabel(/ソース/i).fill('/tmp/test-backup-file.txt');
      await page.getByLabel(/スケジュール/i).fill('0 3 * * *');
      
      // 「保存」ボタンをクリックし、APIレスポンスを待機
      // POST /api/backup/config/targets のレスポンスを待機
      const savePromise = page.waitForResponse(
        response => {
          const url = response.url();
          return url.includes('/api/backup/config/targets') && 
                 !url.match(/\/api\/backup\/config\/targets\/\d+/) && // PUT/DELETEのパスを除外
                 response.request().method() === 'POST' &&
                 response.status() === 200;
        },
        { timeout: 15000 }
      );
      await page.getByRole('button', { name: /保存/i }).click();
      await savePromise;

      // 一覧に新しい対象が表示されることを確認
      await expect(page.getByText('/tmp/test-backup-file.txt')).toBeVisible({ timeout: 5000 });
    });

    test('バックアップ対象の有効/無効を切り替えられる', async ({ page }) => {
      await page.goto('/admin/backup/targets');
      await page.waitForLoadState('networkidle');

      // チェックボックスが表示されるまで待機
      const firstCheckbox = page.locator('input[type="checkbox"]').first();
      await expect(firstCheckbox).toBeVisible({ timeout: 5000 });
      
      const initialChecked = await firstCheckbox.isChecked();

      // チェックボックスをクリックし、APIレスポンスを待機
      // PUT /api/backup/config/targets/:index のレスポンスを待機
      const updatePromise = page.waitForResponse(
        response => {
          const url = response.url();
          return url.match(/\/api\/backup\/config\/targets\/\d+/) && 
                 response.request().method() === 'PUT' &&
                 response.status() === 200;
        },
        { timeout: 15000 }
      );
      await firstCheckbox.click();
      await updatePromise;

      // 状態が変更されたことを確認 (toBeChecked / not.toBeChecked を使用)
      if (initialChecked) {
        await expect(firstCheckbox).not.toBeChecked({ timeout: 3000 });
      } else {
        await expect(firstCheckbox).toBeChecked({ timeout: 3000 });
      }
    });

    test('バックアップ対象を削除できる', async ({ page }) => {
      await page.goto('/admin/backup/targets');
      await page.waitForLoadState('networkidle');

      // 削除ボタンが表示されるまで待機
      await expect(page.getByRole('button', { name: /削除/i }).first()).toBeVisible({ timeout: 5000 });

      // 最初の「削除」ボタンをクリック
      const deleteButtons = page.getByRole('button', { name: /削除/i });
      const deleteButtonCount = await deleteButtons.count();
      
      if (deleteButtonCount > 0) {
        // 確認ダイアログを自動承認
        page.on('dialog', dialog => dialog.accept());
        
        // 削除ボタンをクリックし、APIレスポンスを待機
        // DELETE /api/backup/config/targets/:index のレスポンスを待機
        const deletePromise = page.waitForResponse(
          response => {
            const url = response.url();
            return url.match(/\/api\/backup\/config\/targets\/\d+/) && 
                   response.request().method() === 'DELETE' &&
                   response.status() === 200;
          },
          { timeout: 15000 }
        );
        await deleteButtons.first().click();
        await deletePromise;
        
        // UIが更新されるのを待機
        await page.waitForLoadState('networkidle');
        
        // 削除ボタンの数が減ったことを確認
        const newDeleteButtonCount = await page.getByRole('button', { name: /削除/i }).count();
        expect(newDeleteButtonCount).toBeLessThan(deleteButtonCount);
      }
    });
  });

  test.describe('Gmail設定管理', () => {
    test.beforeEach(async ({ request }) => {
      // E2Eテスト用のbackup.jsonを準備（Gmail設定を含む）
      const backupConfig = {
        storage: {
          provider: 'gmail',
          options: {
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
            subjectPattern: '^CSV Import: (employees|items)-.*',
            labelName: 'Pi5/Processed',
            basePath: '/tmp/gmail-attachments'
          }
        },
        targets: [],
        csvImports: []
      };

      // backup.jsonを更新（Gmail設定を有効化）
      const configResponse = await request.put('http://localhost:8080/api/backup/config', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        data: backupConfig
      });

      if (!configResponse.ok()) {
        // 設定更新に失敗した場合はスキップ
        test.skip();
      }
    });

    test('Gmail OAuth認証URLを取得できる', async ({ request }) => {
      // GET /api/backup/oauth/gmail/authorize のレスポンスを待機
      const response = await request.get('http://localhost:8080/api/backup/oauth/gmail/authorize', {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty('authorizationUrl');
      expect(body).toHaveProperty('state');
      expect(body.authorizationUrl).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
      expect(body.state).toBeTruthy();
    });

    test('Gmail設定を取得できる', async ({ request }) => {
      // GET /api/backup/config/gmail のレスポンスを待機
      const response = await request.get('http://localhost:8080/api/backup/config/gmail', {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty('provider', 'gmail');
      expect(body).toHaveProperty('options');
      expect(body.options).toHaveProperty('clientId');
      expect(body.options).toHaveProperty('subjectPattern');
      expect(body.options).toHaveProperty('labelName');
      expect(body.options).toHaveProperty('hasAccessToken');
      expect(body.options).toHaveProperty('hasRefreshToken');
    });

    test('Gmail設定を更新できる', async ({ request }) => {
      // PUT /api/backup/config/gmail のレスポンスを待機
      const updateData = {
        subjectPattern: '^CSV Import: (employees|items)-\\d{8}$',
        labelName: 'Pi5/Processed/Test'
      };

      const response = await request.put('http://localhost:8080/api/backup/config/gmail', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        data: updateData
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('message', 'Gmail configuration updated successfully');

      // 設定が正しく更新されたことを確認
      const getResponse = await request.get('http://localhost:8080/api/backup/config/gmail', {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      const getBody = await getResponse.json();
      expect(getBody.options.subjectPattern).toBe(updateData.subjectPattern);
      expect(getBody.options.labelName).toBe(updateData.labelName);
    });

    test('Gmail設定が無効な場合にエラーを返す', async ({ request }) => {
      // まず、ストレージプロバイダーをlocalに変更
      const localConfig = {
        storage: {
          provider: 'local',
          options: {
            basePath: '/tmp/test-backups'
          }
        },
        targets: [],
        csvImports: []
      };

      await request.put('http://localhost:8080/api/backup/config', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        data: localConfig
      });

      // Gmail設定を取得しようとするとエラーになる
      const response = await request.get('http://localhost:8080/api/backup/config/gmail', {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.message).toContain('Gmail is not configured');
    });
  });
});

