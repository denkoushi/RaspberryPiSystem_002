import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createAuthHeader, createTestEmployee, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

const MIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function buildMultipartImageField(
  fieldName: string,
  filename: string,
  buf: Buffer,
  mime: string
): { body: Buffer; contentType: string } {
  const boundary = `----testMiGenreImg${Date.now()}`;
  const crlf = '\r\n';
  const parts: Buffer[] = [];
  const push = (s: string) => parts.push(Buffer.from(s, 'utf8'));
  push(`--${boundary}${crlf}`);
  push(
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"${crlf}Content-Type: ${mime}${crlf}${crlf}`
  );
  parts.push(buf);
  push(`${crlf}--${boundary}--${crlf}`);
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

describe('measuring instrument genres integration', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns genre-backed inspection profile for an instrument', async () => {
    const genreResponse = await app.inject({
      method: 'POST',
      url: '/api/measuring-instrument-genres',
      headers: {
        ...createAuthHeader(adminToken),
        'Content-Type': 'application/json'
      },
      payload: {
        name: `ノギス-${randomUUID()}`
      }
    });
    expect(genreResponse.statusCode).toBe(200);
    const genre = genreResponse.json().genre as { id: string; name: string };

    const instrumentResponse = await app.inject({
      method: 'POST',
      url: '/api/measuring-instruments',
      headers: {
        ...createAuthHeader(adminToken),
        'Content-Type': 'application/json'
      },
      payload: {
        name: 'テスト計測機器',
        managementNumber: `MI-${Date.now()}`,
        genreId: genre.id
      }
    });
    expect(instrumentResponse.statusCode).toBe(200);
    const instrument = instrumentResponse.json().instrument as { id: string };

    const itemResponse = await app.inject({
      method: 'POST',
      url: `/api/measuring-instrument-genres/${genre.id}/inspection-items`,
      headers: {
        ...createAuthHeader(adminToken),
        'Content-Type': 'application/json'
      },
      payload: {
        name: '外観点検',
        content: '外観を確認',
        criteria: '異常なし',
        method: '目視',
        order: 1
      }
    });
    expect(itemResponse.statusCode).toBe(200);

    const profileResponse = await app.inject({
      method: 'GET',
      url: `/api/measuring-instruments/${instrument.id}/inspection-profile`,
      headers: createAuthHeader(adminToken)
    });

    expect(profileResponse.statusCode).toBe(200);
    const body = profileResponse.json() as {
      genre: { id: string; name: string } | null;
      inspectionItems: Array<{ name: string; genreId: string }>;
    };
    expect(body.genre?.id).toBe(genre.id);
    expect(body.genre?.name).toBe(genre.name);
    expect(body.inspectionItems).toHaveLength(1);
    expect(body.inspectionItems[0]).toMatchObject({
      name: '外観点検',
      genreId: genre.id
    });
  });

  it('rejects inspection record creation when item genre does not match instrument genre', async () => {
    const genreA = await prisma.measuringInstrumentGenre.create({
      data: { name: `ジャンルA-${randomUUID()}` }
    });
    const genreB = await prisma.measuringInstrumentGenre.create({
      data: { name: `ジャンルB-${randomUUID()}` }
    });
    const instrument = await prisma.measuringInstrument.create({
      data: {
        name: `整合チェック機器-${randomUUID()}`,
        managementNumber: `MI-CHECK-${Date.now()}`,
        genreId: genreA.id
      }
    });
    const inspectionItem = await prisma.inspectionItem.create({
      data: {
        genreId: genreB.id,
        name: `別ジャンル項目-${randomUUID()}`,
        content: '別ジャンル',
        criteria: '一致',
        method: '確認',
        order: 1
      }
    });
    const employee = await createTestEmployee();

    const response = await app.inject({
      method: 'POST',
      url: `/api/measuring-instruments/${instrument.id}/inspection-records`,
      headers: {
        ...createAuthHeader(adminToken),
        'Content-Type': 'application/json'
      },
      payload: {
        employeeId: employee.id,
        inspectionItemId: inspectionItem.id,
        result: 'PASS',
        inspectedAt: new Date().toISOString()
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('整合');
  });

  it('stores uploaded genre images under PHOTO_STORAGE_DIR and serves them back', async () => {
    const tempStorageDir = await mkdtemp(path.join(tmpdir(), 'genre-image-storage-'));
    process.env.PHOTO_STORAGE_DIR = tempStorageDir;

    try {
      const genreResponse = await app.inject({
        method: 'POST',
        url: '/api/measuring-instrument-genres',
        headers: {
          ...createAuthHeader(adminToken),
          'Content-Type': 'application/json'
        },
        payload: {
          name: `画像テスト-${randomUUID()}`
        }
      });
      expect(genreResponse.statusCode).toBe(200);
      const genre = genreResponse.json().genre as { id: string; imageUrlPrimary: string | null };
      const { body, contentType } = buildMultipartImageField('image', 'test.png', MIN_PNG, 'image/png');

      const uploadResponse = await app.inject({
        method: 'POST',
        url: `/api/measuring-instrument-genres/${genre.id}/images/1`,
        headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
        payload: body
      });

      expect(uploadResponse.statusCode).toBe(200);
      const uploadedGenre = uploadResponse.json().genre as { imageUrlPrimary: string };
      expect(uploadedGenre.imageUrlPrimary).toMatch(/^\/api\/storage\/measuring-instrument-genres\/.+\.png$/);

      const filename = path.basename(uploadedGenre.imageUrlPrimary);
      const storedFilePath = path.join(tempStorageDir, 'measuring-instrument-genres', filename);
      await expect(access(storedFilePath)).resolves.toBeUndefined();

      const fileResponse = await app.inject({
        method: 'GET',
        url: uploadedGenre.imageUrlPrimary,
        headers: createAuthHeader(adminToken)
      });

      expect(fileResponse.statusCode).toBe(200);
      expect(fileResponse.headers['content-type']).toContain('image/png');
    } finally {
      delete process.env.PHOTO_STORAGE_DIR;
      await rm(tempStorageDir, { recursive: true, force: true });
    }
  });
});
