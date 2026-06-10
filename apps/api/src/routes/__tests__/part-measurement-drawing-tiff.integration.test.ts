import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createAuthHeader, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

async function cleanPartMeasurementTables() {
  await prisma.selfInspectionMeasurementValue.deleteMany({});
  await prisma.selfInspectionLotEntry.deleteMany({});
  await prisma.selfInspectionSessionResetAuditLog.deleteMany({});
  await prisma.selfInspectionSession.deleteMany({});
  await prisma.partMeasurementResult.deleteMany({});
  await prisma.partMeasurementSheet.deleteMany({});
  await prisma.partMeasurementSession.deleteMany({});
  await prisma.partMeasurementTemplate.deleteMany({});
  await prisma.partMeasurementVisualTemplate.deleteMany({});
}

function buildMultipartTiff(name: string, tiff: Buffer): { body: Buffer; contentType: string } {
  const boundary = `----testPmTiff${Date.now()}`;
  const crlf = '\r\n';
  const parts: Buffer[] = [];
  const push = (s: string) => parts.push(Buffer.from(s, 'utf8'));
  push(`--${boundary}${crlf}`);
  push(`Content-Disposition: form-data; name="name"${crlf}${crlf}${name}${crlf}`);
  push(`--${boundary}${crlf}`);
  push(
    `Content-Disposition: form-data; name="file"; filename="drawing.tiff"${crlf}Content-Type: image/tiff${crlf}${crlf}`
  );
  parts.push(tiff);
  push(`${crlf}--${boundary}--${crlf}`);
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

describe('part-measurement drawing TIFF import', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let sampleTiff: Buffer;

  beforeAll(async () => {
    sampleTiff = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 40, g: 80, b: 120 }
      }
    })
      .tiff()
      .toBuffer();

    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    await cleanPartMeasurementTables();
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('creates visual template from TIFF and stores jpeg drawing path', async () => {
    const { body, contentType } = buildMultipartTiff('tiff-upload', sampleTiff);
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(up.statusCode).toBe(200);
    expect(up.json().visualTemplate.drawingImageRelativePath).toMatch(/\.jpg$/);

    const path = up.json().visualTemplate.drawingImageRelativePath as string;
    const img = await app.inject({
      method: 'GET',
      url: path,
      headers: createAuthHeader(adminToken)
    });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toMatch(/image\/jpeg/);
  });

  it('returns jpeg from drawings preview without persisting storage', async () => {
    const { body, contentType } = buildMultipartTiff('preview-only', sampleTiff);
    const preview = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/drawings/preview',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toMatch(/image\/jpeg/);
    expect(preview.rawPayload.length).toBeGreaterThan(0);

    const countBefore = await prisma.partMeasurementVisualTemplate.count();
    expect(countBefore).toBe(0);
  });
});
