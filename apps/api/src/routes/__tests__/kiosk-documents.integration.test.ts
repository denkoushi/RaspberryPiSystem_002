import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createTestClientDevice } from './helpers.js';

process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('Kiosk documents API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('GET /api/kiosk-documents returns 401 without client-key or JWT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/kiosk-documents' });
    expect(res.statusCode).toBe(401);
  });

  describe('with registered client device', () => {
    let clientKey = '';
    let dbUp = false;

    beforeAll(async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        dbUp = true;
      } catch {
        dbUp = false;
      }
    });

    beforeEach(async () => {
      if (!dbUp) {
        return;
      }
      const client = await createTestClientDevice();
      clientKey = client.apiKey;
    });

    it('GET /api/kiosk-documents returns 200 with valid x-client-key', async () => {
      if (!dbUp) {
        return;
      }
      const res = await app.inject({
        method: 'GET',
        url: '/api/kiosk-documents',
        headers: { 'x-client-key': clientKey },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { documents: unknown[] };
      expect(Array.isArray(body.documents)).toBe(true);
    });

    it('GET /api/kiosk-documents?q= matches substring in extractedText (ILIKE partial match)', async () => {
      if (!dbUp) {
        return;
      }
      const marker = `kiosk_q_extract_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const doc = await prisma.kioskDocument.create({
        data: {
          title: 'Search integration title',
          filename: 'search-test.pdf',
          filePath: `/tmp/kiosk-search-test-${marker}.pdf`,
          sourceType: 'MANUAL',
          enabled: true,
          ocrStatus: 'COMPLETED',
          extractedText: `prefix ${marker} suffix`,
        },
      });
      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/kiosk-documents?q=${encodeURIComponent(marker)}`,
          headers: { 'x-client-key': clientKey },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json() as { documents: Array<{ id: string }> };
        expect(body.documents.some((d) => d.id === doc.id)).toBe(true);
      } finally {
        await prisma.kioskDocument.delete({ where: { id: doc.id } }).catch(() => undefined);
      }
    });

    it('GET /api/kiosk-documents?q= matches confirmed document number and summary text', async () => {
      if (!dbUp) {
        return;
      }
      const marker = `kiosk_summary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const doc = await prisma.kioskDocument.create({
        data: {
          title: 'Search metadata title',
          filename: 'search-metadata-test.pdf',
          filePath: `/tmp/kiosk-search-metadata-${marker}.pdf`,
          sourceType: 'MANUAL',
          enabled: true,
          ocrStatus: 'COMPLETED',
          confirmedDocumentNumber: '産1-G025AAK',
          confirmedSummaryText: `この文書は ${marker} の手順を記載しています`,
        },
      });
      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/kiosk-documents?q=${encodeURIComponent(marker)}`,
          headers: { 'x-client-key': clientKey },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json() as { documents: Array<{ id: string }> };
        expect(body.documents.some((d) => d.id === doc.id)).toBe(true);
      } finally {
        await prisma.kioskDocument.delete({ where: { id: doc.id } }).catch(() => undefined);
      }
    });
  });
});
