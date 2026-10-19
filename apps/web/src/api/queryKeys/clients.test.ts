import { describe, expect, it } from 'vitest';

import { clientsQueryKeys } from './clients';

describe('clientsQueryKeys', () => {
  it('preserves fixed keys and invalidation prefixes', () => {
    expect(clientsQueryKeys.clientsAll).toEqual(['clients']);
    expect(clientsQueryKeys.sitesAll).toEqual(['sites']);
    expect(clientsQueryKeys.kioskSitesAll).toEqual(['kiosk-sites']);
    expect(clientsQueryKeys.statusAll).toEqual(['client-status']);
    expect(clientsQueryKeys.alertsAll).toEqual(['client-alerts']);
  });

  it('preserves log filters including undefined, omitted and empty filters', () => {
    const filters = { clientId: 'client-1', level: 'WARN' as const, limit: 50, since: '2026-10-19T00:00:00Z' };
    expect(clientsQueryKeys.logs(filters)).toEqual(['client-logs', filters]);
    expect(clientsQueryKeys.logs(undefined)).toEqual(['client-logs', undefined]);
    expect(clientsQueryKeys.logs()).toEqual(['client-logs', undefined]);
    expect(clientsQueryKeys.logs({})).toEqual(['client-logs', {}]);
  });
});
