import { describe, expect, it } from 'vitest';

import { postgresPoolConfig } from '../postgres-url-params.js';

const defaults = { connectionLimit: 10, poolTimeoutSeconds: 20, connectTimeoutSeconds: 10 };
const databaseUrl = 'postgresql://u:p@localhost:5432/db';

describe('postgresPoolConfig', () => {
  it('maps the configured pool size and finite connection timeout without requiring TLS', () => {
    expect(postgresPoolConfig(databaseUrl, defaults)).toEqual({
      connectionString: databaseUrl,
      max: 10,
      connectionTimeoutMillis: 20000
    });
  });

  it('honors URL overrides and removes Prisma pool parameters while preserving SSL options', () => {
    expect(postgresPoolConfig(`${databaseUrl}?connection_limit=3&pool_timeout=4&connect_timeout=8&sslmode=disable`, defaults)).toEqual({
      connectionString: `${databaseUrl}?sslmode=disable`,
      max: 3,
      connectionTimeoutMillis: 8000
    });
  });

  it.each([
    [0, 5, 5000],
    [5, 0, 5000],
    [0, 0, 0]
  ])('uses the longer finite bound when pool=%s and connect=%s', (pool, connect, millis) => {
    expect(postgresPoolConfig(`${databaseUrl}?pool_timeout=${pool}&connect_timeout=${connect}`, defaults).connectionTimeoutMillis).toBe(millis);
  });

  it.each(['connection_limit=0', 'connection_limit=bad', 'pool_timeout=-1', 'connect_timeout=1.5'])('rejects invalid setting %s', (query) => {
    expect(() => postgresPoolConfig(`${databaseUrl}?${query}`, defaults)).toThrow('Invalid PostgreSQL pool setting');
  });
});
