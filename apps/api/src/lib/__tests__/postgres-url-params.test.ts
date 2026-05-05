import { describe, expect, it } from 'vitest';

import { mergePostgresUrlQueryParams } from '../postgres-url-params.js';

describe('mergePostgresUrlQueryParams', () => {
  it('appends missing query params', () => {
    const out = mergePostgresUrlQueryParams('postgresql://u:p@localhost:5432/db', {
      connection_limit: '10',
      connect_timeout: '5'
    });
    expect(out).toContain('connection_limit=10');
    expect(out).toContain('connect_timeout=5');
  });

  it('does not overwrite existing keys', () => {
    const out = mergePostgresUrlQueryParams('postgresql://localhost/db?connection_limit=3', {
      connection_limit: '10',
      pool_timeout: '20'
    });
    expect(out).toMatch(/connection_limit=3/);
    expect(out).toContain('pool_timeout=20');
  });
});
