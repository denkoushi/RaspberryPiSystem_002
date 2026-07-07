import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';

import { buildServer } from '../../app.js';
import {
  resetPartMeasurementDrawingDerivativeInFlightForTests
} from '../../lib/part-measurement-drawing-storage.js';
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
  const derivativesDir = path.join(testStorageDir, 'part-measurement-drawings-derivatives');
  const testFilename = 'cache-test-drawing.png';
  const derivativeTestFilename = 'derivative-test-drawing.jpg';
  const smallDerivativeTestFilename = 'small-derivative-test-drawing.png';
  const testDrawingPath = path.join(drawingsDir, testFilename);
  const derivativeTestDrawingPath = path.join(drawingsDir, derivativeTestFilename);
  const smallDerivativeTestDrawingPath = path.join(drawingsDir, smallDerivativeTestFilename);
  const testDrawingUrl = `/api/storage/part-measurement-drawings/${testFilename}`;
  const derivativeTestDrawingUrl = `/api/storage/part-measurement-drawings/${derivativeTestFilename}`;
  const smallDerivativeTestDrawingUrl = `/api/storage/part-measurement-drawings/${smallDerivativeTestFilename}`;

  beforeAll(async () => {
    await fs.mkdir(drawingsDir, { recursive: true });

    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    resetPartMeasurementDrawingDerivativeInFlightForTests();
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
    await fs.writeFile(testDrawingPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await sharp({
      create: {
        width: 2400,
        height: 1200,
        channels: 3,
        background: { r: 120, g: 80, b: 40 }
      }
    })
      .jpeg({ quality: 90 })
      .toFile(derivativeTestDrawingPath);
    await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 3,
        background: { r: 20, g: 120, b: 200 }
      }
    })
      .png()
      .toFile(smallDerivativeTestDrawingPath);
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

  it('returns original image when w is not whitelisted', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${derivativeTestDrawingUrl}?w=999`,
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.rawPayload.length).toBeGreaterThan(0);
  });

  it('returns resized derivative WebP for whitelisted w', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${derivativeTestDrawingUrl}?w=1280`,
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.headers.etag).toMatch(/^"\d+-\d+(\.\d+)?"$/);
    expect(response.headers['cache-control']).toBe('private, max-age=86400, immutable');
    expect(response.rawPayload.length).toBeGreaterThan(0);

    const derivativePath = path.join(derivativesDir, 'w1280', `${derivativeTestFilename}.webp`);
    await expect(fs.stat(derivativePath)).resolves.toBeTruthy();

    const metadata = await sharp(response.rawPayload).metadata();
    expect(metadata.width).toBeLessThanOrEqual(1280);
    expect(metadata.format).toBe('webp');
  });

  it('returns original image when source width is smaller than requested w', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${smallDerivativeTestDrawingUrl}?w=1920`,
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.rawPayload.length).toBeGreaterThan(0);
  });

  it('returns 304 for derivative when If-None-Match matches ETag', async () => {
    const first = await app.inject({
      method: 'GET',
      url: `${derivativeTestDrawingUrl}?w=1920`,
      headers: createAuthHeader(adminToken),
    });

    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();

    const second = await app.inject({
      method: 'GET',
      url: `${derivativeTestDrawingUrl}?w=1920`,
      headers: {
        ...createAuthHeader(adminToken),
        'if-none-match': etag!,
      },
    });

    expect(second.statusCode).toBe(304);
    expect(second.headers.etag).toBe(etag);
    expect(second.rawPayload.length).toBe(0);
  });
});
