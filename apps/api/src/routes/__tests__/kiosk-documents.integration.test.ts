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
  });
});
