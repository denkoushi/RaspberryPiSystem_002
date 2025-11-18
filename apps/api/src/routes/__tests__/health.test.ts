import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('GET /health', () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return ok', async () => {
    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
