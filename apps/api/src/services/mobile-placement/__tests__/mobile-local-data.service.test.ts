import { gunzipSync } from 'node:zlib';

import { enrichLocalPurchaseRows, packPurchase, unpackBasePurchase, unpackPlacement, unpackPurchase } from '@raspi-system/slip-match-core';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ supplements: vi.fn(), placementStamp: vi.fn(), placements: vi.fn(), placementNames: vi.fn(), purchase: vi.fn(), schedule: vi.fn(), dates: vi.fn(), progress: vi.fn(), externalCompletion: vi.fn(), machines: vi.fn(), findMany: vi.fn(),
  queryRaw: vi.fn(), names: vi.fn(), normalized: vi.fn(), machineNames: vi.fn(), allSchedule: vi.fn(), known: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  orderPlacementBranchState: { findMany: mocks.placements },
  purchaseOrderLookupRow: { aggregate: mocks.purchase, findMany: mocks.findMany },
  productionScheduleProgress: { aggregate: mocks.progress }, productionScheduleExternalCompletion: { aggregate: mocks.externalCompletion },
  csvDashboardRow: { aggregate: mocks.schedule }, productionScheduleOrderSupplement: { aggregate: mocks.dates },
  productionScheduleSeibanMachineNameSupplement: { aggregate: mocks.machines, findMany: mocks.supplements }, $queryRaw: (query: TemplateStringsArray, ...args: unknown[]) => query[0].includes('STRING_AGG') ? mocks.placementStamp() : mocks.queryRaw(query, ...args)
} }));
vi.mock('../../production-schedule/production-schedule-lookup.service.js', () => ({ listAllScheduleLookupRows: mocks.allSchedule, listKnownScheduleFseibans: mocks.known }));
vi.mock('../../purchase-order-lookup/purchase-order-lookup-master-part.service.js', () => ({ findMasterFhinmeisByMatchKey: mocks.names, findMasterFhinmeisByNormalizedFhinCd: mocks.normalized }));
vi.mock('../../purchase-order-lookup/purchase-order-lookup-machine-name.service.js', () => ({ resolveMachineNamesForPurchaseLookup: mocks.machineNames }));

vi.mock('../part-search/part-search-machine-name-fseibans.service.js', () => ({ resolvePartSearchMachineNames: mocks.placementNames }));

import { registerMobileLocalDataRoutes } from '../../../routes/kiosk/mobile-local-data.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { queryPurchaseOrderLookup } from '../../purchase-order-lookup/purchase-order-lookup-query.service.js';
import { createMobileDataCache, getMobileDataVersions, invalidateMobileDataVersions } from '../mobile-local-data.service.js';

const stamp = (time = '2026-10-27T00:00:00Z', count = 1) => ({ _count: count, _max: { updatedAt: new Date(time), createdAt: new Date('2026-10-01') } });
const row = { purchaseOrderNo: '1234567890', seiban: 'FS1', purchasePartName: '品名', purchasePartCodeRaw: 'MD1(A)-001', purchasePartCodeNormalized: 'MD1-001', purchasePartCodeMatchKey: 'MD1', acceptedQuantity: 2 };
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.placementStamp.mockResolvedValue([{ count: 1, updatedAt: new Date('2026-10-27'), createdAt: new Date('2026-10-01'), checksum: 'id-1' }]);
  mocks.placements.mockResolvedValue([{ id: 'branch', manufacturingOrderBarcodeRaw: '001', branchNo: 0, shelfCodeRaw: 'A', updatedAt: new Date('2026-10-27'),
    scheduleSnapshot: { FSEIBAN: 'FS1', FHINCD: 'MD1', FHINMEI: 'テーブル', ProductNo: '001' } }]);
  mocks.placementNames.mockResolvedValue(new Map([['FS1', ' ｄａｄ３３５０　テーブル ']]));
  [mocks.purchase, mocks.schedule, mocks.dates, mocks.machines, mocks.progress, mocks.externalCompletion].forEach((fn) => fn.mockResolvedValue(stamp()));
  mocks.findMany.mockResolvedValue([row]); mocks.names.mockResolvedValue({ MD1: 'マスタ' }); mocks.normalized.mockResolvedValue({});
  mocks.machineNames.mockResolvedValue({ FS1: '機種' });
  mocks.queryRaw.mockResolvedValue([{ seiban: 'FS1', fhincd: 'MD1', fhinmei: '品名', productNo: '1', completed: false, plannedStartDate: new Date('2026-11-01') }]);
  mocks.allSchedule.mockResolvedValue([{ rowId: 'r', fseiban: 'FS1', productNo: 'T1', fhincd: 'MD1', fhinmei: '品名', fsigencd: 'M', fkojun: 1 }]);
  mocks.known.mockResolvedValue(['FS1', 'FS_WITH_NO_PART']);
  mocks.supplements.mockResolvedValue([{ fseiban: 'SUPPLEMENT_ONLY' }]);
  await getMobileDataVersions(true);
  vi.clearAllMocks();
});
afterEach(() => { vi.useRealTimers(); });

describe('mobile data versions and snapshots', () => {
  it('versions each dataset only from its source tables', async () => {
    const first = await getMobileDataVersions();
    expect(await getMobileDataVersions()).toEqual(first);
    for (const [source, changed] of [
      [mocks.purchase, ['purchase', 'legacyPurchase']],
      [mocks.schedule, ['schedule', 'purchaseEnrichment', 'placements', 'legacyPurchase']],
      [mocks.dates, ['purchaseEnrichment', 'legacyPurchase']],
      [mocks.machines, ['purchaseEnrichment', 'placements', 'legacyPurchase']]
    ] as const) {
      for (const value of [stamp('2026-10-28T00:00:00Z'), stamp(undefined, 0)]) {
        source.mockResolvedValue(value);
        const next = await getMobileDataVersions(true);
        for (const kind of Object.keys(first) as (keyof typeof first)[]) {
          expect(next[kind].version === first[kind].version, kind).toBe(!changed.includes(kind as never));
        }
      }
      source.mockResolvedValue(stamp());
    }
  });
  it.each(['progress', 'externalCompletion'] as const)('invalidates only purchase display data for %s changes', async (source) => {
    const first = await getMobileDataVersions();
    for (const changed of [stamp('2026-10-28T00:00:00Z'), stamp(undefined, 2),
      { ...stamp(), _max: { ...stamp()._max, createdAt: new Date('2026-10-29') } }]) {
      mocks[source].mockResolvedValue(changed);
      const next = await getMobileDataVersions(true);
      expect(next.purchaseEnrichment.version).not.toBe(first.purchaseEnrichment.version);
      expect(next.legacyPurchase.version).not.toBe(first.legacyPurchase.version);
      expect(next.purchase).toEqual(first.purchase);
      expect(next.schedule).toEqual(first.schedule);
      expect(next.placements).toEqual(first.placements);
    }
    expect(mocks[source]).toHaveBeenCalledWith({ _count: true, _max: { updatedAt: true, createdAt: true },
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID } });
  });
  it('invalidates placements on insert, update, delete and same-count replacement without changing other datasets', async () => {
    const first = await getMobileDataVersions();
    for (const changes of [{ count: 2 }, { updatedAt: new Date('2026-10-28') }, { count: 0 }, { checksum: 'id-2' }]) {
      mocks.placementStamp.mockResolvedValue([{ count: 1, updatedAt: new Date('2026-10-27'), createdAt: new Date('2026-10-01'), checksum: 'id-1', ...changes }]);
      const next = await getMobileDataVersions(true);
      expect(next.placements.version).not.toBe(first.placements.version);
      expect(next.purchase).toEqual(first.purchase); expect(next.schedule).toEqual(first.schedule);
    }
  });
  it('invalidates placements for either machine-name source and preserves display kana', async () => {
    const first = await getMobileDataVersions();
    for (const source of [mocks.schedule, mocks.machines]) {
      source.mockResolvedValue(stamp('2026-10-28T00:00:00Z'));
      expect((await getMobileDataVersions(true)).placements.version).not.toBe(first.placements.version);
      source.mockResolvedValue(stamp());
    }
    await getMobileDataVersions(true);
    const snapshot = await createMobileDataCache()('placements');
    const data = JSON.parse(gunzipSync(snapshot.gzip).toString());
    expect(unpackPlacement(data.rows[0])).toEqual({ id: 'branch', manufacturingOrderBarcodeRaw: '001', branchNo: 0,
      shelfCodeRaw: 'A', updatedAt: '2026-10-27T00:00:00.000Z', fseiban: 'FS1', fhincd: 'MD1', fhinmei: 'テーブル',
      productNo: '001', machineName: 'DAD3350 テーブル' });
    expect(mocks.placementNames).toHaveBeenCalledWith(['FS1']);
  });
  it('serves placements with authentication, 304, and cached full snapshots', async () => {
    const app = Fastify();
    await registerMobileLocalDataRoutes(app, { requireClientDevice: async (key) => {
      if (!key) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
      return {} as never;
    } });
    try {
      expect((await app.inject('/kiosk/mobile-local-data/placements')).statusCode).toBe(401);
      const headers = { 'x-client-key': 'key' };
      const version = (await getMobileDataVersions()).placements.version;
      expect((await app.inject({ url: `/kiosk/mobile-local-data/placements?version=${version}`, headers })).statusCode).toBe(304);
      expect(mocks.placements).not.toHaveBeenCalled();
      const response = await app.inject({ url: '/kiosk/mobile-local-data/placements', headers });
      expect(response.statusCode).toBe(200);
      expect(unpackPlacement(response.json().rows[0]).id).toBe('branch');
      await app.inject({ url: '/kiosk/mobile-local-data/placements', headers });
      expect(mocks.placements).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
  it('invalidates cached versions after deletion and prevents an older in-flight read from republishing them', async () => {
    const first = await getMobileDataVersions();
    let release!: (value: Awaited<ReturnType<typeof mocks.placementStamp>>) => void;
    mocks.placementStamp.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const beforeDelete = getMobileDataVersions(true);
    invalidateMobileDataVersions();
    mocks.placementStamp.mockResolvedValue([{ count: 0, updatedAt: null, createdAt: null, checksum: 'empty' }]);
    const afterDelete = await getMobileDataVersions();
    expect(afterDelete.placements.version).not.toBe(first.placements.version);
    release([{ count: 1, updatedAt: new Date('2026-10-27'), createdAt: new Date('2026-10-01'), checksum: 'id-1' }]);
    await beforeDelete;
    expect(await getMobileDataVersions()).toEqual(afterDelete);
  });
  it('caches versions for 30 seconds and shares concurrent refreshes', async () => {
    vi.useFakeTimers();
    const first = await getMobileDataVersions(true);
    mocks.purchase.mockClear();
    mocks.purchase.mockResolvedValue(stamp('2026-10-28T00:00:00Z'));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(await getMobileDataVersions()).toEqual(first);
    expect(mocks.purchase).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const [a, b] = await Promise.all([getMobileDataVersions(), getMobileDataVersions()]);
    expect(a).toBe(b); expect(a.purchase.version).not.toBe(first.purchase.version);
    expect(mocks.purchase).toHaveBeenCalledTimes(1);
  });
  it('serves exactly the joined lookup fields, preserving the matching key', async () => {
    const lookup = await queryPurchaseOrderLookup(row.purchaseOrderNo);
    const cached = await createMobileDataCache()('legacyPurchase');
    const data = JSON.parse(gunzipSync(cached.gzip).toString()) as { rows: Parameters<typeof unpackPurchase>[0][] };
    expect(unpackPurchase(data.rows[0])).toEqual({ ...lookup.rows[0], purchaseOrderNo: row.purchaseOrderNo, purchasePartCodeMatchKey: 'MD1' });
    expect(cached.jsonBytes).toBe(gunzipSync(cached.gzip).length);
    expect(cached).not.toHaveProperty('json');
  });
  it('builds independent purchase without joins and joins enrichment to the same server display fields', async () => {
    const cache = createMobileDataCache();
    const raw = JSON.parse(gunzipSync((await cache('purchase')).gzip).toString());
    expect(raw.format).toBe(2);
    expect(mocks.names).not.toHaveBeenCalled(); expect(mocks.queryRaw).not.toHaveBeenCalled();
    const enrichment = JSON.parse(gunzipSync((await cache('purchaseEnrichment')).gzip).toString());
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.machineNames).toHaveBeenCalledWith(['FS1', 'FS_WITH_NO_PART', 'SUPPLEMENT_ONLY']);
    const lookup = await queryPurchaseOrderLookup(row.purchaseOrderNo);
    expect(enrichLocalPurchaseRows(raw.rows.map(unpackBasePurchase), enrichment.rows)[0]).toEqual({
      ...lookup.rows[0], purchaseOrderNo: row.purchaseOrderNo, purchasePartCodeMatchKey: row.purchasePartCodeMatchKey
    });
  });
  it('negotiates independent data while preserving the old purchase wire format and version', async () => {
    const app = Fastify();
    await registerMobileLocalDataRoutes(app, { requireClientDevice: async () => ({} as never) });
    try {
      const old = (await app.inject('/kiosk/mobile-local-data/versions')).json();
      const modern = (await app.inject('/kiosk/mobile-local-data/versions?format=2')).json();
      expect(old).not.toHaveProperty('purchaseEnrichment');
      expect(old).not.toHaveProperty('paged');
      expect(modern.paged).toBe(true);
      expect(modern).toHaveProperty('purchaseEnrichment'); expect(modern).not.toHaveProperty('legacyPurchase');
      expect(old.purchase.version).not.toBe(modern.purchase.version);
      const legacy = (await app.inject('/kiosk/mobile-local-data/purchase')).json();
      expect(legacy.version).toBe(old.purchase.version);
      expect(unpackPurchase(legacy.rows[0])).toMatchObject({ masterPartName: 'マスタ', machineName: '機種', plannedStartDate: '2026-11-01' });
      const raw = (await app.inject('/kiosk/mobile-local-data/purchase?format=2')).json();
      expect(raw).toMatchObject({ format: 2, version: modern.purchase.version });
      expect(raw).not.toHaveProperty('page');
      expect(legacy).not.toHaveProperty('page');
      expect(unpackBasePurchase(raw.rows[0])).toMatchObject(row);
      expect((await app.inject(`/kiosk/mobile-local-data/purchase?format=2&version=${modern.purchase.version}`)).statusCode).toBe(304);
      const enrichment = (await app.inject('/kiosk/mobile-local-data/purchaseEnrichment')).json();
      expect(enrichment.version).toBe(modern.purchaseEnrichment.version);
      expect((await app.inject(`/kiosk/mobile-local-data/purchaseEnrichment?version=${enrichment.version}`)).statusCode).toBe(304);
    } finally { await app.close(); }
  });
  it('shares concurrent builds and does not rebuild an unchanged version', async () => {
    const cache = createMobileDataCache();
    const [a, b] = await Promise.all([cache('purchase'), cache('purchase')]);
    expect(a).toBe(b); expect(await cache('purchase')).toBe(a);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    mocks.dates.mockResolvedValue(stamp('2026-10-29T00:00:00Z'));
    await getMobileDataVersions(true);
    expect(await cache('purchase')).toBe(a);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    mocks.purchase.mockResolvedValue(stamp('2026-10-29T00:00:00Z'));
    await getMobileDataVersions(true);
    expect((await cache('purchase')).version).not.toBe(a.version);
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
  });
  it('uses the route version and still forces an uncached check after building', async () => {
    const versions = vi.fn().mockResolvedValue({ purchase: { version: 'p1', dataUpdatedAt: null } });
    const build = vi.fn().mockResolvedValue({ rows: [] });
    const cache = createMobileDataCache(versions, build);
    await cache('purchase', { version: 'p1', dataUpdatedAt: null });
    expect(versions).toHaveBeenCalledExactlyOnceWith(true);
    await cache('purchase', { version: 'p1', dataUpdatedAt: null });
    expect(versions).toHaveBeenCalledTimes(1);
  });
  it('detects changes during a build even inside the version cache TTL', async () => {
    const build = vi.fn(async () => {
      mocks.purchase.mockResolvedValue(stamp('2026-10-29T00:00:00Z'));
      return { rows: [] };
    });
    await expect(createMobileDataCache(getMobileDataVersions, build)('purchase')).rejects.toThrow('changed');
  });
  it('fetches and enriches purchase pages in lineIndex/id order before fetching the next page', async () => {
    const first = Array.from({ length: 5000 }, (_, i) => ({ ...row, id: `id-${i}`, lineIndex: Math.floor(i / 2),
      purchaseOrderNo: String(i).padStart(10, '0') }));
    const last = { ...row, id: 'last', lineIndex: 2500 };
    mocks.findMany.mockImplementationOnce(async () => first).mockImplementationOnce(async () => {
      expect(mocks.machineNames).toHaveBeenCalledTimes(1);
      return [last];
    });
    const cached = await createMobileDataCache()('legacyPurchase');
    expect(mocks.findMany).toHaveBeenNthCalledWith(1, { take: 5000, orderBy: [{ lineIndex: 'asc' }, { id: 'asc' }] });
    expect(mocks.findMany).toHaveBeenNthCalledWith(2, { take: 5000, orderBy: [{ lineIndex: 'asc' }, { id: 'asc' }], cursor: { id: 'id-4999' }, skip: 1 });
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    const data = JSON.parse(gunzipSync(cached.gzip).toString()) as { rows: Parameters<typeof unpackPurchase>[0][] };
    expect(data.rows.map((r) => unpackPurchase(r).purchaseOrderNo)).toEqual([...first, last].map((r) => r.purchaseOrderNo));
    expect(unpackPurchase(data.rows[5000])).toMatchObject({ machineName: '機種', masterPartName: 'マスタ' });
  });
  it('rejects a snapshot changed during construction and permits retry', async () => {
    const versions = vi.fn().mockResolvedValue({ purchase: { version: 'v1', dataUpdatedAt: null }, schedule: { version: 's1', dataUpdatedAt: null } });
    const build = vi.fn(async () => {
      versions.mockResolvedValue({ purchase: { version: 'v2', dataUpdatedAt: null }, schedule: { version: 's1', dataUpdatedAt: null } });
      return { rows: [] };
    });
    const cache = createMobileDataCache(versions, build);
    await expect(cache('purchase')).rejects.toThrow('changed');
    await expect(cache('purchase')).resolves.toMatchObject({ version: 'v2' });
  });
  it('reports a realistic 225k-row serialization/gzip size and time (synthetic, excludes DB joins)', async () => {
    const rows = Array.from({ length: 225_000 }, (_, i) => packPurchase({ ...row, purchaseOrderNo: String(i).padStart(10, '0'), seiban: `FS${i % 22000}`,
      masterPartName: 'マスタ部品名称', machineName: '工作機械', plannedStartDate: '2026-10-27' }));
    const data = await createMobileDataCache(getMobileDataVersions, () => Promise.resolve({ rows }))('purchase');
    expect(data.rowCount).toBe(225_000); expect(data.gzip.length).toBeLessThan(data.jsonBytes);
    expect(data.pages).toHaveLength(20);
    expect(data.pageSize).toBe(11_250);
    console.info(JSON.stringify({ syntheticRows: data.rowCount, jsonBytes: data.jsonBytes, gzipBytes: data.gzip.length, buildMs: data.buildMs }));
  });
  it('caches stable gzip pages, keeps known seibans on page one and retains the full response', async () => {
    const rows = Array.from({ length: 10_001 }, (_, i) => ['r' + i, 'FS1', String(i), 'MD1', 'Part', 'M', 1]);
    const build = vi.fn().mockResolvedValue({ rows, knownFseibans: ['FS1', 'FS_NO_PART'] });
    const cache = createMobileDataCache(getMobileDataVersions, build);
    const snapshot = await cache('schedule');
    const pages = snapshot.pages.map((page) => JSON.parse(gunzipSync(page.gzip).toString()));
    expect(pages).toHaveLength(3);
    expect(pages.map((page) => page.page)).toEqual([1, 2, 3]);
    expect(pages.every((page) => page.pageSize === 5000 && page.pageCount === 3)).toBe(true);
    expect(pages[0].knownFseibans).toEqual(['FS1', 'FS_NO_PART']);
    expect(pages[1]).not.toHaveProperty('knownFseibans');
    expect(pages[2]).not.toHaveProperty('knownFseibans');
    expect(pages.flatMap((page) => page.rows)).toEqual(rows);
    expect(JSON.parse(gunzipSync(snapshot.gzip).toString())).toMatchObject({ rows, knownFseibans: ['FS1', 'FS_NO_PART'] });
    expect(await cache('schedule')).toBe(snapshot);
    expect(build).toHaveBeenCalledTimes(1);
  });
  it('serves negotiated pages, ignores size hints, and returns 409 for a changed pageVersion before 304', async () => {
    const app = Fastify();
    await registerMobileLocalDataRoutes(app, { requireClientDevice: async () => ({} as never) });
    mocks.schedule.mockResolvedValue(stamp('2026-10-30T00:00:00Z'));
    const current = (await getMobileDataVersions(true)).schedule;
    try {
      const url = `/kiosk/mobile-local-data/schedule?format=2&page=1&pageVersion=${current.version}`;
      const first = await app.inject(url + '&pageSize=1');
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ ...current, page: 1, pageCount: 1, pageSize: 5000,
        knownFseibans: ['FS1', 'FS_WITH_NO_PART'] });
      const zipped = await app.inject({ url: url + '&pageSize=99999', headers: { 'accept-encoding': 'gzip' } });
      expect(gunzipSync(zipped.rawPayload).toString()).toBe(first.body);
      const full = (await app.inject('/kiosk/mobile-local-data/schedule?format=2')).json();
      expect(full).toEqual({ ...current, rows: first.json().rows, knownFseibans: ['FS1', 'FS_WITH_NO_PART'] });
      expect((await app.inject('/kiosk/mobile-local-data/schedule?page=1')).statusCode).toBe(400);
      expect((await app.inject('/kiosk/mobile-local-data/schedule?format=2&page=2')).statusCode).toBe(400);
      expect((await app.inject('/kiosk/mobile-local-data/purchaseEnrichment?format=2&page=1')).statusCode).toBe(400);
      mocks.schedule.mockResolvedValue(stamp('2026-10-31T00:00:00Z'));
      const next = (await getMobileDataVersions(true)).schedule;
      expect((await app.inject(url + `&version=${next.version}`)).statusCode).toBe(409);
      const restarted = await app.inject(`/kiosk/mobile-local-data/schedule?format=2&page=1&pageVersion=${next.version}`);
      expect(restarted.statusCode).toBe(200);
      expect(restarted.json().version).toBe(next.version);
    } finally { await app.close(); }
  });
  it('authenticates version/data routes, returns 304 without build, and sends gzip', async () => {
    const app = Fastify();
    const requireClientDevice = vi.fn(async (key: unknown) => {
      if (key !== 'key') throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
      return {} as never;
    });
    await registerMobileLocalDataRoutes(app, { requireClientDevice });
    try {
      expect((await app.inject('/kiosk/mobile-local-data/versions')).statusCode).toBe(401);
      expect((await app.inject('/kiosk/mobile-local-data/purchase')).statusCode).toBe(401);
      const response = await app.inject({ url: '/kiosk/mobile-local-data/versions', headers: { 'x-client-key': 'key' } });
      const versions = response.json<Awaited<ReturnType<typeof getMobileDataVersions>>>();
      expect(response.statusCode).toBe(200);
      const unchanged = await app.inject({ url: `/kiosk/mobile-local-data/purchase?version=${versions.purchase.version}`, headers: { 'x-client-key': 'key' } });
      expect(unchanged.statusCode).toBe(304); expect(unchanged.body).toBe(''); expect(mocks.findMany).not.toHaveBeenCalled();
      const data = await app.inject({ url: '/kiosk/mobile-local-data/schedule', headers: { 'x-client-key': 'key', 'accept-encoding': 'gzip' } });
      expect(data.headers['content-encoding']).toBe('gzip');
      expect(JSON.parse(gunzipSync(data.rawPayload).toString())).toMatchObject({ version: versions.schedule.version,
        rows: [['r', 'FS1', 'T1', 'MD1', '品名', 'M', 1]], knownFseibans: ['FS1', 'FS_WITH_NO_PART'] });
      for (const acceptEncoding of ['', 'gzip;q=0']) {
        const plain = await app.inject({ url: '/kiosk/mobile-local-data/schedule', headers: { 'x-client-key': 'key', 'accept-encoding': acceptEncoding } });
        expect(plain.headers['content-encoding']).toBeUndefined();
        expect(plain.body).toBe(gunzipSync(data.rawPayload).toString());
      }
      expect(mocks.schedule).toHaveBeenCalledTimes(1); // Only the post-build freshness check.
      expect(mocks.allSchedule).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
});
