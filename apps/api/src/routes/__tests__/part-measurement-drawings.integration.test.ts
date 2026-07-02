import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

import { buildServer } from '../../app.js';
import { createAuthHeader, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';
process.env.CAMERA_TYPE ??= 'mock';
process.env.PHOTO_STORAGE_DIR ??= '/tmp/test-photo-storage';

describe('GET /api/storage/part-measurement-drawings/*', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  const testStorageDir = process.env.PHOTO_STORAGE_DIR!;
  const drawingsDir = path.join(testStorageDir, 'part-measurement-drawings');
  const testFilename = 'cache-test-drawing.png';
  const testDrawingPath = path.join(drawingsDir, testFilename);
  const testDrawingUrl = `/api/storage/part-measurement-drawings/${testFilename}`;

  beforeAll(async () => {
    await fs.mkdir(drawingsDir, { recursive: true });

    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
    await fs.writeFile(testDrawingPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
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

  it('returns ETag and Cache-Control on 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: testDrawingUrl,
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers.etag).toMatch(/^"\d+-\d+(\.\d+)?"$/);
    expect(response.headers['cache-control']).toBe('private, max-age=86400, immutable');
    expect(response.rawPayload).toBeTruthy();
  });

  it('returns 304 when If-None-Match matches ETag', async () => {
    const first = await app.inject({
      method: 'GET',
      url: testDrawingUrl,
      headers: createAuthHeader(adminToken),
    });

    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();

    const second = await app.inject({
      method: 'GET',
      url: testDrawingUrl,
      headers: {
        ...createAuthHeader(adminToken),
        'if-none-match': etag!,
      },
    });

    expect(second.statusCode).toBe(304);
    expect(second.headers.etag).toBe(etag);
    expect(second.headers['cache-control']).toBe('private, max-age=86400, immutable');
    expect(second.rawPayload.length).toBe(0);
  });
});
