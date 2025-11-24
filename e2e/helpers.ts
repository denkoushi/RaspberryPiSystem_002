import { Page, APIRequestContext } from '@playwright/test';

/**
 * テスト用のユーザー情報を生成（実際の作成はAPI経由で行う）
 */
export function generateTestUser(): { username: string; password: string } {
  const username = `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const password = 'test-password-123';
  return { username, password };
}

/**
 * ログインしてトークンを取得
 */
export async function login(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const response = await request.post('http://localhost:8080/api/auth/login', {
    data: { username, password },
  });

  if (!response.ok()) {
    throw new Error(`Login failed: ${response.status()}`);
  }

  const body = await response.json();
  return body.accessToken;
}

/**
 * ページにログイン状態を設定
 */
export async function setAuthToken(page: Page, token: string): Promise<void> {
  await page.addInitScript((t) => {
    localStorage.setItem('auth_token', t);
  }, token);
}

/**
 * テスト用の従業員を作成（API経由）
 */
export async function createTestEmployee(
  request: APIRequestContext,
  token: string,
  data?: {
    employeeCode?: string;
    displayName?: string;
    nfcTagUid?: string;
  },
): Promise<void> {
  await request.post('http://localhost:8080/api/tools/employees', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: {
      employeeCode: data?.employeeCode ?? `EMP${Date.now()}`,
      displayName: data?.displayName ?? 'Test Employee',
      nfcTagUid: data?.nfcTagUid ?? `TAG_EMP_${Date.now()}`,
      department: 'Test Department',
    },
  });
}

/**
 * テスト用のアイテムを作成（API経由）
 */
export async function createTestItem(
  request: APIRequestContext,
  token: string,
  data?: {
    itemCode?: string;
    name?: string;
    nfcTagUid?: string;
  },
): Promise<void> {
  await request.post('http://localhost:8080/api/tools/items', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: {
      itemCode: data?.itemCode ?? `ITEM${Date.now()}`,
      name: data?.name ?? 'Test Item',
      nfcTagUid: data?.nfcTagUid ?? `TAG_ITEM_${Date.now()}`,
      category: 'Test Category',
    },
  });
}

