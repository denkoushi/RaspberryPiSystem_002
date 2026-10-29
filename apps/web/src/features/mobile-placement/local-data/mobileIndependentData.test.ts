import { packBasePurchase, packPurchase } from '@raspi-system/slip-match-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMobileLocalDataStore } from './mobileLocalDataStore';
import { createMobileDataSync } from './mobileLocalDataSync';

import type { BasePurchaseSnapshot, PurchaseEnrichmentSnapshot } from '@raspi-system/slip-match-core';

const row = { purchaseOrderNo: '001', seiban: 'FS1', purchasePartName: 'Part', purchasePartCodeRaw: 'MD1',
  purchasePartCodeNormalized: 'MD1', purchasePartCodeMatchKey: 'MD1', acceptedQuantity: 1,
  masterPartName: 'legacy master', machineName: 'legacy machine', plannedStartDate: '2026-10-01' };
const purchase: BasePurchaseSnapshot = { format: 2, version: 'base1', dataUpdatedAt: null, rows: [packBasePurchase(row)] };
const schedule = { version: 's1', dataUpdatedAt: null, rows: [], knownFseibans: [] };
const placements = { version: 'b1', dataUpdatedAt: null, rows: [] };
const purchaseEnrichment: PurchaseEnrichmentSnapshot = { version: 'e1', dataUpdatedAt: null, rows: [
  ['match', 'MD1', 'master'], ['machine', 'FS1', 'machine'], ['date', 'FS1', 'MD1', 'Part', '2026-11-01', '1', 0]
] };
const legacy = { version: 'legacy1', dataUpdatedAt: null, rows: [packPurchase(row)] };
const remoteApi = () => ({ versions: vi.fn().mockResolvedValue({ purchase, schedule, placements, purchaseEnrichment }),
  purchase: vi.fn().mockResolvedValue(purchase), schedule: vi.fn().mockResolvedValue(schedule),
  placements: vi.fn().mockResolvedValue(placements), purchaseEnrichment: vi.fn().mockResolvedValue(purchaseEnrichment) });
afterEach(() => { vi.restoreAllMocks(); });

describe('independent mobile datasets', () => {
  it('joins display fields and syncs schedule/derived updates without downloading or replacing purchase', async () => {
    const store = createMobileLocalDataStore(); const remote = remoteApi(); const sync = createMobileDataSync(store, remote);
    const replace = vi.spyOn(store, 'replace');
    await sync();
    expect(remote.purchase).toHaveBeenCalledExactlyOnceWith(undefined, true);
    expect((await store.lookupPurchase('001'))?.rows[0]).toMatchObject({ ...row, masterPartName: 'master', machineName: 'machine', plannedStartDate: '2026-11-01' });
    const updated = { ...purchaseEnrichment, version: 'e2', rows: [] };
    remote.versions.mockResolvedValue({ purchase, schedule: { ...schedule, version: 's2' }, placements, purchaseEnrichment: updated });
    remote.schedule.mockResolvedValue({ ...schedule, version: 's2' }); remote.purchaseEnrichment.mockResolvedValue(updated);
    await sync();
    expect(remote.purchase).toHaveBeenCalledTimes(1);
    expect(remote.placements).toHaveBeenCalledTimes(1);
    expect(replace.mock.lastCall?.[0]).not.toHaveProperty('purchase');
    expect((await store.lookupPurchase('001'))?.rows[0]).toMatchObject({ masterPartName: '', machineName: '', plannedStartDate: null });
    await sync(); expect(remote.purchaseEnrichment).toHaveBeenCalledTimes(2);
  });
  it('supports an old API and safely switches both ways without joining stale enrichment to legacy rows', async () => {
    const store = createMobileLocalDataStore(); const remote = remoteApi(); const sync = createMobileDataSync(store, remote);
    remote.versions.mockResolvedValue({ purchase: legacy, schedule }); remote.purchase.mockResolvedValue(legacy);
    await sync();
    expect(remote.purchaseEnrichment).not.toHaveBeenCalled();
    expect((await store.lookupPurchase('001'))?.rows[0]).toMatchObject(row);
    remote.versions.mockResolvedValue({ purchase, schedule, placements, purchaseEnrichment }); remote.purchase.mockResolvedValue(purchase);
    await sync();
    expect(remote.purchase).toHaveBeenLastCalledWith(undefined, true);
    expect((await store.lookupPurchase('001'))?.rows[0].masterPartName).toBe('master');
    remote.versions.mockResolvedValue({ purchase: legacy, schedule }); remote.purchase.mockResolvedValue(legacy);
    await sync();
    expect(remote.purchase).toHaveBeenLastCalledWith(undefined);
    expect((await store.versions()).purchaseEnrichment).toBeUndefined();
    expect((await store.lookupPurchase('001'))?.rows[0]).toMatchObject(row);
  });
  it.each(['failure', 'version race', 'missing', 'wrong purchase format'])('does not publish partial datasets on %s', async (mode) => {
    const store = createMobileLocalDataStore(); await store.replace({ purchase: legacy, schedule });
    const remote = remoteApi();
    if (mode === 'failure') remote.purchaseEnrichment.mockRejectedValue(new Error('failed download'));
    if (mode === 'version race') remote.purchaseEnrichment.mockResolvedValue({ ...purchaseEnrichment, version: 'e2' });
    if (mode === 'missing') remote.purchaseEnrichment.mockResolvedValue(null);
    if (mode === 'wrong purchase format') remote.purchase.mockResolvedValue({ ...legacy, version: purchase.version });
    await expect(createMobileDataSync(store, remote)()).rejects.toThrow();
    expect((await store.versions()).purchase?.version).toBe('legacy1');
    expect((await store.lookupPurchase('001'))?.rows[0]).toMatchObject(row);
  });
  it('does not expose unenriched base purchases when no enrichment snapshot is available', async () => {
    const store = createMobileLocalDataStore(); await store.replace({ purchase });
    expect(await store.lookupPurchase('001')).toBeNull();
    await store.replace({ purchaseEnrichment });
    expect((await store.lookupPurchase('001'))?.rows[0].masterPartName).toBe('master');
  });
});
