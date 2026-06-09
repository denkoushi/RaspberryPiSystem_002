import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../app.js';
import { buildMinimalValidPdfBuffer } from '../../lib/__tests__/fixtures/minimal-pdf.js';
import { prisma } from '../../lib/prisma.js';
import { createAuthHeader, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

/** pdftoppm 非依存: 変換結果として最小 JPEG を返す */
const MOCK_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iX2NnPk46Ry0sXT9PW0xUX1L/2wBDAQ4ODhUSD1JES081PSEhP0hLSlpNUVNXX2ddZmdfXWJmYmJ5d3N2d3l5d3d5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXn/wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=',
  'base64'
);

vi.mock('../../lib/convert-pdf-first-page-to-jpeg.js', () => ({
  convertPdfFirstPageToJpeg: vi.fn(async () => MOCK_JPEG),
  buildPdftoppmFirstPageArgs: vi.fn()
}));

const MIN_PDF = buildMinimalValidPdfBuffer();

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

function buildMultipartPdf(name: string, pdf: Buffer): { body: Buffer; contentType: string } {
  const boundary = `----testPmPdfMock${Date.now()}`;
  const crlf = '\r\n';
  const parts: Buffer[] = [];
  const push = (s: string) => parts.push(Buffer.from(s, 'utf8'));
  push(`--${boundary}${crlf}`);
  push(`Content-Disposition: form-data; name="name"${crlf}${crlf}${name}${crlf}`);
  push(`--${boundary}${crlf}`);
  push(
    `Content-Disposition: form-data; name="file"; filename="drawing.pdf"${crlf}Content-Type: application/pdf${crlf}${crlf}`
  );
  parts.push(pdf);
  push(`${crlf}--${boundary}--${crlf}`);
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

describe('part-measurement drawing PDF import (mocked convert)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;

  beforeAll(async () => {
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

  it('creates visual template from PDF without pdftoppm on host', async () => {
    const { body, contentType } = buildMultipartPdf('pdf-mocked', MIN_PDF);
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
});
