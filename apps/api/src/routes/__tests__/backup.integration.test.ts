import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createAuthHeader, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';
process.env.BACKUP_STORAGE_DIR ??= '/tmp/test-backups';

describe('Backup API integration', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let authHeader: Record<string, string>;
  let testUser: { user: Awaited<ReturnType<typeof createTestUser>>['user']; token: string; password: string };

  beforeEach(async () => {
    app = await buildServer();
    
    // テスト用の管理者ユーザーを作成
    const userResult = await createTestUser('ADMIN');
    testUser = userResult.user;

    authHeader = createAuthHeader(userResult.token);
  });

  afterEach(async () => {
    // テストデータをクリーンアップ
    await prisma.employee.deleteMany({});
    await prisma.item.deleteMany({});
    if (testUser) {
      await prisma.user.delete({ where: { id: testUser.id } });
    }
    await app.close();
  });

  it('should backup employees CSV', async () => {
    // テストデータをクリーンアップ（他のテストの影響を防ぐ）
    await prisma.employee.deleteMany({});
    
    // テストデータを作成（一意のemployeeCodeを使用）
    const uniqueCode = `EMP${Date.now().toString().slice(-6)}`;
    await prisma.employee.create({
      data: {
        employeeCode: uniqueCode,
        displayName: 'テスト従業員',
        status: 'ACTIVE'
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/backup',
      headers: authHeader,
      payload: {
        kind: 'csv',
        source: 'employees',
        metadata: {
          label: 'test-employees-backup'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.path).toBeDefined();
    expect(body.sizeBytes).toBeGreaterThan(0);
  });

  it('should list backups', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/backup',
      headers: authHeader
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body.backups)).toBe(true);
  });

  it('should get backup config', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/backup/config',
      headers: authHeader
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.storage).toBeDefined();
    expect(body.targets).toBeDefined();
    expect(Array.isArray(body.targets)).toBe(true);
  });

  describe('Backup target management', () => {
    it('should add a backup target', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/backup/config/targets',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        payload: {
          kind: 'file',
          source: '/tmp/test-file.txt',
          schedule: '0 3 * * *',
          enabled: true
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.target).toBeDefined();
      expect(body.target.kind).toBe('file');
      expect(body.target.source).toBe('/tmp/test-file.txt');
      expect(body.target.enabled).toBe(true);

      // 設定が正しく保存されたことを確認
      const configResponse = await app.inject({
        method: 'GET',
        url: '/api/backup/config',
        headers: authHeader
      });
      const configBody = JSON.parse(configResponse.body);
      const addedTarget = configBody.targets.find((t: { source: string }) => t.source === '/tmp/test-file.txt');
      expect(addedTarget).toBeDefined();
      expect(addedTarget.kind).toBe('file');
    });

    it('should update a backup target', async () => {
      // まず設定を取得して、既存のtargetのインデックスを確認
      const configResponse = await app.inject({
        method: 'GET',
        url: '/api/backup/config',
        headers: authHeader
      });
      const configBody = JSON.parse(configResponse.body);
      const initialTargetCount = configBody.targets.length;

      // 新しいtargetを追加
      const addResponse = await app.inject({
        method: 'POST',
        url: '/api/backup/config/targets',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        payload: {
          kind: 'directory',
          source: '/tmp/test-dir',
          schedule: '0 4 * * *',
          enabled: true
        }
      });
      expect(addResponse.statusCode).toBe(200);

      // 追加したtargetのインデックス（最後の要素）
      const targetIndex = initialTargetCount;

      // targetを更新
      const updateResponse = await app.inject({
        method: 'PUT',
        url: `/api/backup/config/targets/${targetIndex}`,
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        payload: {
          enabled: false,
          schedule: '0 5 * * *'
        }
      });

      expect(updateResponse.statusCode).toBe(200);
      const updateBody = JSON.parse(updateResponse.body);
      expect(updateBody.success).toBe(true);
      expect(updateBody.target.enabled).toBe(false);
      expect(updateBody.target.schedule).toBe('0 5 * * *');

      // 設定が正しく更新されたことを確認
      const verifyResponse = await app.inject({
        method: 'GET',
        url: '/api/backup/config',
        headers: authHeader
      });
      const verifyBody = JSON.parse(verifyResponse.body);
      const updatedTarget = verifyBody.targets[targetIndex];
      expect(updatedTarget.enabled).toBe(false);
      expect(updatedTarget.schedule).toBe('0 5 * * *');
    });

    it('should delete a backup target', async () => {
      // まず設定を取得
      const configResponse = await app.inject({
        method: 'GET',
        url: '/api/backup/config',
        headers: authHeader
      });
      const configBody = JSON.parse(configResponse.body);
      const initialTargetCount = configBody.targets.length;

      // 新しいtargetを追加
      const addResponse = await app.inject({
        method: 'POST',
        url: '/api/backup/config/targets',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        payload: {
          kind: 'file',
          source: '/tmp/to-delete.txt',
          enabled: true
        }
      });
      expect(addResponse.statusCode).toBe(200);

      // 追加したtargetのインデックス（最後の要素）
      const targetIndex = initialTargetCount;

      // targetを削除
      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/backup/config/targets/${targetIndex}`,
        headers: authHeader
      });

      expect(deleteResponse.statusCode).toBe(200);
      const deleteBody = JSON.parse(deleteResponse.body);
      expect(deleteBody.success).toBe(true);
      expect(deleteBody.target.source).toBe('/tmp/to-delete.txt');

      // 設定から削除されたことを確認
      const verifyResponse = await app.inject({
        method: 'GET',
        url: '/api/backup/config',
        headers: authHeader
      });
      const verifyBody = JSON.parse(verifyResponse.body);
      expect(verifyBody.targets.length).toBe(initialTargetCount);
      const deletedTarget = verifyBody.targets.find((t: { source: string }) => t.source === '/tmp/to-delete.txt');
      expect(deletedTarget).toBeUndefined();
    });

    it('should reject invalid target index', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/backup/config/targets/9999',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        payload: {
          enabled: false
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid kind', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/backup/config/targets',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        payload: {
          kind: 'invalid-kind',
          source: '/tmp/test.txt',
          enabled: true
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require source field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/backup/config/targets',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        payload: {
          kind: 'file',
          enabled: true
        }
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
