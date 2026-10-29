import { packBasePurchase, packPlacement, packSchedule } from '@raspi-system/slip-match-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMobileLocalDataStore } from './mobileLocalDataStore';
import { createMobileDataSync, mobileDataApi } from './mobileLocalDataSync';

import type { PagedDataset } from './mobileLocalDataStore';

const row = { purchaseOrderNo: '1234567890', seiban: 'FS1', purchasePartName: 'Old part', purchasePartCodeRaw: 'MD1',
  purchasePartCodeNormalized: 'MD1', purchasePartCodeMatchKey: 'MD1', acceptedQuantity: 1 };
const scheduleRow = { rowId: 'r1', fseiban: 'FS1', productNo: 'T1', fhincd: 'MD1', fhinmei: 'Old part', fsigencd: 'M', fkojun: 1 };
const purchase = { version: 'p1', dataUpdatedAt: null, format: 2 as const, rows: [packBasePurchase(row)] };
const schedule = { version: 's1', dataUpdatedAt: null, rows: [packSchedule(scheduleRow)], knownFseibans: ['FS1'] };
const placements = { version: 'b1', dataUpdatedAt: null, rows: [] };
const purchaseEnrichment = { version: 'e1', dataUpdatedAt: null, rows: [] };
const input = { transferOrderBarcodeRaw: 'T1', actualOrderBarcodeRaw: row.purchaseOrderNo, actualFseibanRaw: '' };
const versions = { purchase, schedule, placements, purchaseEnrichment, paged: true as const };
const remoteApi = () => ({ versions: vi.fn().mockResolvedValue({ ...versions, purchase: { ...purchase, version: 'p2' } }),
  purchase: vi.fn(), schedule: vi.fn(), placements: vi.fn(), purchaseEnrichment: vi.fn(),
  page: vi.fn<typeof mobileDataApi.page>(async (_kind, page, version) => ({ version, dataUpdatedAt: null, format: 2,
    page, pageCount: 3, pageSize: 1, rows: [packBasePurchase({ ...row, purchaseOrderNo: page === 1 ? row.purchaseOrderNo : `00${page}`,
      purchasePartName: 'New part', purchasePartCodeMatchKey: 'MD2' })] })) });

beforeEach(() => { vi.stubGlobal('indexedDB', undefined); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('paged mobile data synchronization', () => {
  it('resumes at page three after two committed pages and keeps matching on the old snapshot until promotion', async () => {
    const store = createMobileLocalDataStore();
    await store.replace({ purchase, schedule, placements, purchaseEnrichment });
    const remote = remoteApi();
    const getPage = remote.page.getMockImplementation()!;
    remote.page.mockImplementation(async (kind, page, version, size) => {
      if (page === 3) throw new Error('disconnected');
      return getPage(kind, page, version, size);
    });
    await expect(createMobileDataSync(store, remote)()).rejects.toThrow('disconnected');
    expect(await store.stagingState('purchase')).toMatchObject({ version: 'p2', nextPage: 3, pageSize: 1, pageCount: 3 });
    expect((await store.versions()).purchase?.version).toBe('p1');
    expect((await store.lookupPurchase(row.purchaseOrderNo))?.rows[0].purchasePartName).toBe('Old part');
    expect(await store.verify(input)).toMatchObject({ ok: true });
    remote.page.mockImplementation(getPage).mockClear();
    await createMobileDataSync(store, remote)();
    expect(remote.page).toHaveBeenCalledExactlyOnceWith('purchase', 3, 'p2', 1);
    expect((await store.versions()).purchase).toMatchObject({ version: 'p2', format: 2 });
    expect((await store.lookupPurchase(row.purchaseOrderNo))?.rows[0].purchasePartName).toBe('New part');
    expect(await store.verify(input)).toMatchObject({ ok: false, reason: 'different_part' });
    expect(await store.stagingState('purchase')).toBeUndefined();
    expect(remote.purchase).not.toHaveBeenCalled();
    expect(remote.purchaseEnrichment).not.toHaveBeenCalled();
  });
  it('discards staging on 409 and starts page one for the new version on the next synchronization', async () => {
    const store = createMobileLocalDataStore();
    await store.replace({ purchase, schedule, placements, purchaseEnrichment });
    const remote = remoteApi();
    const getPage = remote.page.getMockImplementation()!;
    remote.page.mockImplementation(async (kind, page, version, size) => page === 3 ? null : getPage(kind, page, version, size));
    const sync = createMobileDataSync(store, remote);
    await expect(sync()).rejects.toThrow('changed during paged download');
    expect(await store.stagingState('purchase')).toBeUndefined();
    expect((await store.versions()).purchase?.version).toBe('p1');
    remote.versions.mockResolvedValue({ ...versions, purchase: { ...purchase, version: 'p3' } });
    remote.page.mockImplementation(getPage).mockClear();
    await sync();
    expect(remote.page.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['purchase', 1, 'p3'], ['purchase', 2, 'p3'], ['purchase', 3, 'p3']
    ]);
    expect((await store.versions()).purchase?.version).toBe('p3');
  });
  it('starts over when the versions response changes and never promotes rows from different versions', async () => {
    const store = createMobileLocalDataStore();
    await store.replace({ purchase, schedule, placements, purchaseEnrichment });
    await store.writeStagingPage('purchase', { ...purchase, version: 'outdated' }, 1, 2, [packBasePurchase({ ...row, purchaseOrderNo: 'stale' })], 1);
    const remote = remoteApi();
    await createMobileDataSync(store, remote)();
    expect(remote.page).toHaveBeenNthCalledWith(1, 'purchase', 1, 'p2', undefined);
    expect((await store.lookupPurchase('stale'))?.rows).toEqual([]);
    expect((await store.lookupPurchase('003'))?.rows).toHaveLength(1);
  });
  it('rejects a changed response version, preserves visible data and clears the partial version', async () => {
    const store = createMobileLocalDataStore();
    await store.replace({ purchase, schedule, placements, purchaseEnrichment });
    const remote = remoteApi();
    const getPage = remote.page.getMockImplementation()!;
    remote.page.mockImplementation(async (kind, page, version, size) => getPage(kind, page, page === 2 ? 'p3' : version, size));
    await expect(createMobileDataSync(store, remote)()).rejects.toThrow('changed during paged download');
    expect((await store.versions()).purchase?.version).toBe('p1');
    expect(await store.stagingState('purchase')).toBeUndefined();
  });
  it('promotes schedule known seibans with the final page and pages placements without paging enrichment', async () => {
    const store = createMobileLocalDataStore();
    await store.replace({ purchase, schedule, placements, purchaseEnrichment });
    const remote = remoteApi();
    remote.versions.mockResolvedValue({ ...versions, schedule: { ...schedule, version: 's2' }, placements: { ...placements, version: 'b2' },
      purchaseEnrichment: { ...purchaseEnrichment, version: 'e2' } });
    remote.purchaseEnrichment.mockResolvedValue({ ...purchaseEnrichment, version: 'e2' });
    remote.page.mockImplementation(async (kind, page, version) => {
      expect((await store.versions()).schedule?.version).toBe('s1');
      expect(await store.snapNative(['NEW'], '')).toMatchObject({ fseibanMatch: 'none' });
      return { version, dataUpdatedAt: null, page, pageCount: kind === 'schedule' ? 2 : 1, pageSize: 1,
        rows: kind === 'schedule' ? [packSchedule({ ...scheduleRow, rowId: `new-${page}` })]
          : [packPlacement({ id: 'b2', manufacturingOrderBarcodeRaw: 'T1', branchNo: 0, shelfCodeRaw: 'A', updatedAt: '',
            fseiban: '', fhincd: '', fhinmei: '', productNo: '', machineName: '' })],
        ...(kind === 'schedule' && page === 1 ? { knownFseibans: ['NEW'] } : {}) };
    });
    await createMobileDataSync(store, remote)();
    expect(await store.snapNative(['NEW'], '')).toMatchObject({ fseibanMatch: 'exact' });
    expect(await store.listScheduleByProductNo('T1')).toHaveLength(2);
    expect((await store.listPlacements())[0].id).toBe('b2');
    expect(remote.page.mock.calls.map(([kind]) => kind)).toEqual(['schedule', 'schedule', 'placements']);
    expect(remote.purchaseEnrichment).toHaveBeenCalledExactlyOnceWith('e1');
  });
  it.each(['purchase', 'schedule', 'placements'] as PagedDataset[])('keeps %s pages idempotent and refuses incomplete promotion', async (kind) => {
    const store = createMobileLocalDataStore();
    const version = { version: 'new', dataUpdatedAt: null, ...(kind === 'purchase' ? { format: 2 as const } : {}) };
    const rows = kind === 'purchase' ? [packBasePurchase(row)] : kind === 'schedule' ? [packSchedule(scheduleRow)] : [];
    const size = Math.max(1, rows.length);
    await store.writeStagingPage(kind, version, 1, 2, rows.length ? rows : [
      packPlacement({ id: 'b', manufacturingOrderBarcodeRaw: 'T1', branchNo: 0, shelfCodeRaw: 'A', updatedAt: '',
        fseiban: '', fhincd: '', fhinmei: '', productNo: '', machineName: '' })
    ], size, ['FS1']);
    await expect(store.promoteStaging(kind)).rejects.toThrow('incomplete');
    await store.writeStagingPage(kind, version, 2, 2, rows, size);
    await store.writeStagingPage(kind, version, 2, 2, rows, size);
    expect((await store.stagingState(kind))?.nextPage).toBe(3);
    await store.promoteStaging(kind);
    expect((await store.versions())[kind]?.version).toBe('new');
  });
});
