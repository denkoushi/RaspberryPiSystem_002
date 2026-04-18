import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createAuthHeader, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('GET /api/reports/loan-report/preview', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let authHeader: Record<string, string>;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
    const { token } = await createTestUser('ADMIN');
    authHeader = createAuthHeader(token);
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('returns preview payload for all categories', async () => {
    const categories = ['measuring', 'rigging', 'tools'] as const;
    for (const category of categories) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/reports/loan-report/preview?category=${category}&periodFrom=2024-01-01&periodTo=2024-01-31&monthlyMonths=3&timeZone=Asia/Tokyo`,
        headers: authHeader,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        reportModel?: { metrics?: { returnRate?: number; out?: number; returned?: number } };
        html?: string;
      };
      expect(typeof body.html).toBe('string');
      expect(typeof body.reportModel?.metrics?.returnRate).toBe('number');
      expect(typeof body.reportModel?.metrics?.out).toBe('number');
      expect(typeof body.reportModel?.metrics?.returned).toBe('number');
    }
  });
});
