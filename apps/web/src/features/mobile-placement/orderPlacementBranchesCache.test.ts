import { beforeEach, describe, expect, it, vi } from 'vitest';

import { overlayPendingBranches, readOrderBranches, saveOrderBranches } from './orderPlacementBranchesCache';

import type { HaizenQueueRecord } from './haizen/offline/haizenOfflineQueueStore';

const branch = (branchNo: number, shelfCodeRaw = 'old') => ({ id: `b${branchNo}`, manufacturingOrderBarcodeRaw: 'ORDER', branchNo,
  shelfCodeRaw, csvDashboardRowId: null, updatedAt: '2026-10-27T00:00:00Z' });
const pending = (branchNo: number, shelfCode = 'new'): HaizenQueueRecord => ({ clientRecordId: `p${branchNo}`, branchNo, shelfCode,
  number: 'ORDER', status: 'pending', slipKind: 'manufacturing_order', scannedAt: '2026-10-27T01:00:00Z' });
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('order branch cache', () => {
  it('stores the last successful list per trimmed order and distinguishes unknown from empty', () => {
    expect(readOrderBranches('ORDER')).toBeUndefined();
    saveOrderBranches(' ORDER ', { branches: [branch(1)] });
    expect(readOrderBranches('ORDER')).toEqual({ branches: [branch(1)] });
    expect(readOrderBranches('OTHER')).toBeUndefined();
    saveOrderBranches('ORDER', { branches: [] });
    expect(readOrderBranches('ORDER')).toEqual({ branches: [] });
  });
  it('overlays the latest pending shelf per branch while retaining other branches and excluding unrelated records', () => {
    const saved = { branches: [branch(1), branch(2)] };
    const result = overlayPendingBranches(' ORDER ', saved, [pending(1), pending(3),
      { ...pending(1, 'latest'), scannedAt: '2026-10-27T02:00:00Z' },
      { ...pending(4), status: 'needs_check' }, { ...pending(5), number: 'OTHER' }, { ...pending(0), branchNo: undefined }]);
    expect(result.branches.map((b) => [b.branchNo, b.shelfCodeRaw])).toEqual([[2, 'old'], [3, 'new'], [1, 'latest']]);
    expect(saved.branches).toEqual([branch(1), branch(2)]);
  });
  it.each([[0, 2], [2, 0]])('does not let cached mode %i disable queued mode %i', (cached, queued) => {
    expect(overlayPendingBranches('ORDER', { branches: [branch(cached)] }, [pending(queued)]).branches)
      .toEqual([expect.objectContaining({ branchNo: queued, shelfCodeRaw: 'new' })]);
  });
  it('treats corrupt and inaccessible storage as unknown', () => {
    saveOrderBranches('ORDER', { branches: [branch(0)] });
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('{"branches":[null]}');
    expect(readOrderBranches('ORDER')).toBeUndefined();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readOrderBranches('ORDER')).toBeUndefined();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => saveOrderBranches('ORDER', { branches: [] })).not.toThrow();
  });
});
