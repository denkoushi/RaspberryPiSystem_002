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
});
