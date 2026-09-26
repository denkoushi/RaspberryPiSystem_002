import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Real PostgreSQL check that an explicit ClientDevice.siteKey reaches the
 * string-based site derivations (docs/plans/explicit-site-scope-execplan.md, Milestone 2).
 * Runs only with a dedicated TEST_DATABASE_URL (not the shared borrow_return database).
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? '';
const databaseName = (() => {
  try {
    return new URL(testDatabaseUrl).pathname.replace(/^\//, '').split('?')[0] ?? '';
  } catch {
    return '';
  }
})();
const hasDedicatedDatabase = Boolean(testDatabaseUrl) && !['borrow_return', 'postgres', 'template1'].includes(databaseName);
const describeIntegration = hasDedicatedDatabase ? describe : describe.skip;

type PrismaClient = import('@prisma/client').PrismaClient;
let prisma: PrismaClient | undefined;
let directory: typeof import('../site-directory.js') | undefined;
let deviceScope: typeof import('../manual-order-device-scope.js') | undefined;

const PREFIX = `site-dir-it-${Date.now()}`;

describeIntegration('site directory on PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ prisma } = await import('../prisma.js'));
    directory = await import('../site-directory.js');
    deviceScope = await import('../manual-order-device-scope.js');
    await prisma!.site.upsert({ where: { key: '第2工場' }, update: {}, create: { key: '第2工場', displayName: '第2工場' } });
    await prisma!.clientDevice.createMany({
      data: [
        { apiKey: `${PREFIX}-mac`, name: `${PREFIX}-Mac`, location: null, siteKey: '第2工場' },
        { apiKey: `${PREFIX}-phone`, name: `${PREFIX}-phone`, location: `${PREFIX}-factory`, siteKey: '第2工場' },
        { apiKey: `${PREFIX}-kiosk`, name: `${PREFIX}-kiosk`, location: `${PREFIX}工場 - A`, siteKey: null }
      ]
    });
  });

  afterEach(() => directory?.resetSiteDirectoryForTest());

  afterAll(async () => {
    await prisma?.clientDevice.deleteMany({ where: { apiKey: { startsWith: PREFIX } } });
    await prisma?.$disconnect();
  });

  it('resolves scope keys of explicitly assigned devices to their site and keeps the guess otherwise', async () => {
    expect(directory!.resolveSiteKeyForScopeKey(`${PREFIX}-Mac`)).toBe(`${PREFIX}-Mac`);
    await directory!.refreshSiteDirectory(prisma!);
    expect(directory!.resolveSiteKeyForScopeKey(`${PREFIX}-Mac`)).toBe('第2工場');
    expect(directory!.resolveSiteKeyForScopeKey(`${PREFIX}-factory`)).toBe('第2工場');
    expect(directory!.resolveSiteKeyForScopeKey(`${PREFIX}工場 - A`)).toBe(`${PREFIX}工場`);
  });

  it('lists devices by explicit site and still lists location-guessed devices', async () => {
    const onSite = await deviceScope!.listRegisteredDeviceScopeKeysForSite('第2工場');
    expect(onSite).toContain(`${PREFIX}-factory`);
    expect(onSite).not.toContain(`${PREFIX}-Mac`);
    expect(await deviceScope!.listRegisteredDeviceScopeKeysForSite(`${PREFIX}工場`)).toEqual([`${PREFIX}工場 - A`]);
  });
});
