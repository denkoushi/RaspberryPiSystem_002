import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createAuthHeader, createTestUser } from './helpers.js';
import { promises as fs } from 'fs';
import path from 'path';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';
process.env.CAMERA_TYPE ??= 'mock';
process.env.PHOTO_STORAGE_DIR ??= '/tmp/test-photo-storage';

describe('GET /api/storage/photos/*', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  const testStorageDir = process.env.PHOTO_STORAGE_DIR!;

  beforeAll(async () => {
    // テスト用のストレージディレクトリを作成
    await fs.mkdir(path.join(testStorageDir, 'photos', '2025', '11'), { recursive: true });

    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    // テスト用のストレージディレクトリを削除
    try {
      await fs.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // エラーは無視
    }

    if (closeServer) {
      await closeServer();
    }
  });

  it('should return photo with authentication', async () => {
    // テスト用の写真ファイルを作成
    const testPhotoPath = path.join(testStorageDir, 'photos', '2025', '11', 'test.jpg');
    await fs.writeFile(testPhotoPath, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])); // 最小限のJPEGヘッダー

    const response = await app.inject({
      method: 'GET',
      url: '/api/storage/photos/2025/11/test.jpg',
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.rawPayload).toBeTruthy();
  });

  it('should return 401 without authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/storage/photos/2025/11/test.jpg',
    });

    expect(response.statusCode).toBe(401);
  });

  it('should return 404 for non-existent photo', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/storage/photos/2025/11/non-existent.jpg',
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.message).toContain('写真が見つかりません');
  });
});

