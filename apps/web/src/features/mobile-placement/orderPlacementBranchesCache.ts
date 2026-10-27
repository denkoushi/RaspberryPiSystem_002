import type { HaizenQueueRecord } from './haizen/offline/haizenOfflineQueueStore';
import type { getOrderPlacementBranches } from '../../api/client';

type Branches = Awaited<ReturnType<typeof getOrderPlacementBranches>>;
const cacheKey = (order: string) => `mobile-placement-order-branches-v1:${order.trim()}`;

export function readOrderBranches(order: string): Branches | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(cacheKey(order)) ?? 'null');
    if (value && typeof value === 'object' && 'branches' in value && Array.isArray(value.branches) &&
      value.branches.every((branch: unknown) => branch && typeof branch === 'object' &&
        'branchNo' in branch && Number.isInteger(branch.branchNo) && Number(branch.branchNo) >= 0 && Number(branch.branchNo) <= 5 &&
        'shelfCodeRaw' in branch && typeof branch.shelfCodeRaw === 'string')) return value as Branches;
  } catch { /* Missing or unavailable storage means unknown, not an empty branch list. */ }
}

export function saveOrderBranches(order: string, value: Branches) {
  try { localStorage.setItem(cacheKey(order), JSON.stringify(value)); } catch { /* Keep the live result. */ }
}

export function overlayPendingBranches(order: string, saved: Branches, records: HaizenQueueRecord[]): Branches {
  let branches = saved.branches;
  for (const record of [...records].sort((a, b) => a.scannedAt.localeCompare(b.scannedAt))) {
    if (record.status !== 'pending' || record.number.trim() !== order.trim() || record.branchNo === undefined) continue;
    // A queued choice supersedes the cached mode as well as the cached shelf of this stamp.
    // The server remains responsible for resolving conflicts when these records are sent.
    branches = branches.filter((branch) => branch.branchNo !== record.branchNo &&
      (record.branchNo === 0 ? branch.branchNo === 0 : branch.branchNo !== 0));
    branches.push({ id: record.clientRecordId, manufacturingOrderBarcodeRaw: order.trim(), branchNo: record.branchNo,
      shelfCodeRaw: record.shelfCode, csvDashboardRowId: null, updatedAt: record.scannedAt });
  }
  return { branches };
}
