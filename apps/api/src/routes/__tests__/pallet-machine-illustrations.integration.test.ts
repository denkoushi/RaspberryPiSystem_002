import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

import { buildServer } from '../../app.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';
process.env.CAMERA_TYPE ??= 'mock';
process.env.PHOTO_STORAGE_DIR ??= '/tmp/test-photo-storage';

describe('GET /api/storage/pallet-machine-illustrations/*', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  const testStorageDir = process.env.PHOTO_STORAGE_DIR!;

  beforeAll(async () => {
    await fs.mkdir(path.join(testStorageDir, 'pallet-machine-illustrations'), { recursive: true });

    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  afterAll(async () => {
    try {
      await fs.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // cleanup best effort
    }

    if (closeServer) {
      await closeServer();
    }
  });

  it('認証なしでもイラストを取得できる', async () => {
    const illustrationPath = path.join(testStorageDir, 'pallet-machine-illustrations', 'test.jpg');
    await fs.writeFile(illustrationPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

    const response = await app.inject({
      method: 'GET',
      url: '/api/storage/pallet-machine-illustrations/test.jpg?cache=1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.rawPayload).toBeTruthy();
  });

  it('存在しないイラストは404を返す', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/storage/pallet-machine-illustrations/missing.jpg',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toContain('イラストが見つかりません');
  });
});
