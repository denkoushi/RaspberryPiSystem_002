import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createTestClientDevice, createTestEmployee } from './helpers.js';
import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';
process.env.CAMERA_TYPE ??= 'mock'; // テストではモックカメラを使用
process.env.PHOTO_STORAGE_DIR ??= '/tmp/test-photo-storage'; // テスト用の一時ディレクトリ
process.env.PDF_STORAGE_DIR ??= '/tmp/test-photo-storage';
process.env.SIGNAGE_RENDER_DIR ??= '/tmp/test-photo-storage/signage';
process.env.PDF_PAGES_DIR ??= '/tmp/test-photo-storage/pdf-pages';
process.env.ALERTS_DIR ??= '/tmp/test-photo-storage/alerts';

describe('POST /api/tools/loans/photo-borrow', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let clientId: string;
  let clientApiKey: string;
  let employeeId: string;
  let employeeTagUid: string;
const testStorageDir = process.env.PHOTO_STORAGE_DIR!;
let brightPhotoBase64: string;
let darkPhotoBase64: string;

const buildPayload = (overrides: Record<string, unknown> = {}) => ({
  employeeTagUid,
  photoData: brightPhotoBase64,
  ...overrides,
});

  beforeAll(async () => {
    // テスト用のストレージディレクトリを作成
    await fs.mkdir(path.join(testStorageDir, 'photos'), { recursive: true });
    await fs.mkdir(path.join(testStorageDir, 'thumbnails'), { recursive: true });
    await fs.mkdir(path.join(testStorageDir, 'pdfs'), { recursive: true });
    await fs.mkdir(path.join(testStorageDir, 'pdf-pages'), { recursive: true });
    await fs.mkdir(path.join(testStorageDir, 'signage'), { recursive: true });
    await fs.mkdir(path.join(testStorageDir, 'alerts'), { recursive: true });

    const brightBuffer = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 240, g: 240, b: 240 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    brightPhotoBase64 = brightBuffer.toString('base64');

    const darkBuffer = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .jpeg({ quality: 80 })
      .toBuffer();
    darkPhotoBase64 = darkBuffer.toString('base64');

    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const client = await createTestClientDevice();
    clientId = client.id;
    clientApiKey = client.apiKey;
    const employee = await createTestEmployee();
    employeeId = employee.id;
    employeeTagUid = employee.nfcTagUid ?? '';
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

  it('should create a photo loan successfully', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/loans/photo-borrow',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey,
      },
      payload: buildPayload({
        clientId,
        note: 'Test photo borrow',
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('loan');
    expect(body.loan.employeeId).toBe(employeeId);
    expect(body.loan.itemId).toBeNull(); // 写真撮影持出ではitemIdはNULL
    expect(body.loan.photoUrl).toBeTruthy();
    expect(body.loan.photoTakenAt).toBeTruthy();
    expect(body.loan.photoUrl).toMatch(/^\/api\/storage\/photos\/\d{4}\/\d{2}\/\d{8}_\d{6}_[a-f0-9-]+\.jpg$/);
  });

  it('should return 404 for non-existent employee tag', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/loans/photo-borrow',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey,
      },
      payload: buildPayload({
        employeeTagUid: 'NON-EXISTENT-TAG',
        clientId,
      }),
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.message).toContain('従業員が登録されていません');
  });

  it('should create photo loan without clientId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/loans/photo-borrow',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey,
      },
      payload: buildPayload(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('loan');
    expect(body.loan.employeeId).toBe(employeeId);
  });

  it('should save photo files correctly', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/loans/photo-borrow',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey,
      },
      payload: buildPayload(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const photoUrl = body.loan.photoUrl;

    // 写真ファイルが存在するか確認
    const relativePath = photoUrl.replace('/api/storage/photos/', '');
    const fullPath = path.join(testStorageDir, 'photos', relativePath);
    const thumbnailPath = path.join(testStorageDir, 'thumbnails', relativePath.replace('.jpg', '_thumb.jpg'));

    // ファイルが存在するか確認
    try {
      const photoStats = await fs.stat(fullPath);
      expect(photoStats.isFile()).toBe(true);
      expect(photoStats.size).toBeGreaterThan(0);

      const thumbnailStats = await fs.stat(thumbnailPath);
      expect(thumbnailStats.isFile()).toBe(true);
      expect(thumbnailStats.size).toBeGreaterThan(0);
    } catch (error) {
      // ファイルが存在しない場合はエラー
      throw new Error(`Photo files not found: ${error}`);
    }
  });

  it('should reject photos that are too dark', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/loans/photo-borrow',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey,
      },
      payload: buildPayload({
        photoData: darkPhotoBase64,
      }),
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.message).toContain('暗');
  });
});

