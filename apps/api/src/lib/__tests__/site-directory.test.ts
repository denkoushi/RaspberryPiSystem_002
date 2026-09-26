import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SITE_DIRECTORY_TTL_MS,
  buildExplicitSiteMap,
  ensureSiteDirectoryFresh,
  invalidateSiteDirectory,
  refreshSiteDirectory,
  resetSiteDirectoryForTest,
  resolveSiteKeyForScopeKey,
  type SiteDirectoryDeviceRow
} from '../site-directory.js';

function clientReturning(...batches: Array<SiteDirectoryDeviceRow[] | Error>) {
  return clientWithSites(['第2工場'], ...batches);
}

function clientWithSites(siteKeys: string[], ...batches: Array<SiteDirectoryDeviceRow[] | Error>) {
  const findMany = vi.fn(async () => {
    const next = batches.shift();
    if (next instanceof Error) throw next;
    return next ?? [];
  });
  const siteFindMany = vi.fn(async () => siteKeys.map((key) => ({ key })));
  return { client: { clientDevice: { findMany }, site: { findMany: siteFindMany } }, findMany };
}

describe('site-directory', () => {
  afterEach(() => resetSiteDirectoryForTest());

  it('falls back to the location text guess when no device has an explicit site', async () => {
    const { client } = clientReturning([
      { name: 'Mac', location: null, siteKey: null },
      { name: 'raspi4', location: '第2工場 - Sessaku-01', siteKey: null }
    ]);
    await refreshSiteDirectory(client, 1_000);
    expect(resolveSiteKeyForScopeKey('Mac')).toBe('Mac');
    expect(resolveSiteKeyForScopeKey(' 第2工場 - Sessaku-01 ')).toBe('第2工場');
    expect(resolveSiteKeyForScopeKey('第2工場')).toBe('第2工場');
    expect(resolveSiteKeyForScopeKey('')).toBe('default');
  });

  it('returns the explicit site of the device that owns the scope key', async () => {
    const { client } = clientReturning([
      { name: 'Mac', location: '  ', siteKey: '第2工場' },
      { name: 'aquos', location: 'factory', siteKey: ' 第2工場 ' },
      { name: 'raspi4', location: '第2工場 - Sessaku-01', siteKey: null }
    ]);
    await refreshSiteDirectory(client, 1_000);
    expect(resolveSiteKeyForScopeKey('Mac')).toBe('第2工場');
    expect(resolveSiteKeyForScopeKey('factory')).toBe('第2工場');
    expect(resolveSiteKeyForScopeKey('第2工場 - Sessaku-01')).toBe('第2工場');
  });

  it('never re-resolves a registered site key, so resolution is idempotent', async () => {
    // A device whose scope key equals another site's key must not redirect that site.
    const { client } = clientWithSites(
      ['第2工場', 'トークプラザ'],
      [
        { name: 'mac', location: 'Mac', siteKey: '第2工場' },
        { name: 'odd', location: '第2工場', siteKey: 'トークプラザ' }
      ]
    );
    await refreshSiteDirectory(client, 1_000);
    const once = resolveSiteKeyForScopeKey('Mac');
    expect(once).toBe('第2工場');
    expect(resolveSiteKeyForScopeKey(once)).toBe('第2工場');
    expect(resolveSiteKeyForScopeKey('トークプラザ')).toBe('トークプラザ');
  });

  it('ignores explicit sites that conflict for the same scope key', () => {
    const map = buildExplicitSiteMap([
      { name: 'a', location: 'shared-key', siteKey: '第2工場' },
      { name: 'b', location: 'shared-key', siteKey: 'トークプラザ' },
      { name: 'c', location: 'same-key', siteKey: '第2工場' },
      { name: 'd', location: 'same-key', siteKey: '第2工場' }
    ]);
    expect(map.has('shared-key')).toBe(false);
    expect(map.get('same-key')).toBe('第2工場');
  });

  it('reloads only after the TTL and keeps the previous directory on failure', async () => {
    const { client, findMany } = clientReturning(
      [{ name: 'Mac', location: null, siteKey: '第2工場' }],
      new Error('db down'),
      [{ name: 'Mac', location: null, siteKey: null }]
    );
    await ensureSiteDirectoryFresh(client, SITE_DIRECTORY_TTL_MS);
    await ensureSiteDirectoryFresh(client, SITE_DIRECTORY_TTL_MS + 1);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(resolveSiteKeyForScopeKey('Mac')).toBe('第2工場');

    await expect(ensureSiteDirectoryFresh(client, SITE_DIRECTORY_TTL_MS * 2)).rejects.toThrow('db down');
    expect(resolveSiteKeyForScopeKey('Mac')).toBe('第2工場');
    await ensureSiteDirectoryFresh(client, SITE_DIRECTORY_TTL_MS * 2 + 1);
    expect(findMany).toHaveBeenCalledTimes(2);

    invalidateSiteDirectory();
    await ensureSiteDirectoryFresh(client, SITE_DIRECTORY_TTL_MS * 2 + 2);
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(resolveSiteKeyForScopeKey('Mac')).toBe('Mac');
  });
});
