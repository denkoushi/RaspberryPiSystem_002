import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_KIOSK_DISPLAY_LIMITS,
  compareEmployeesByPeriodActivity,
  countPeriodEventKinds,
  periodReturnCompletionRatePercent,
  sortPeriodEventsNewestFirst,
  summarizeAssetInventory,
  takeTodayEventsForDisplay,
  topRankedAssetsByBorrow,
  topRankedEmployees
} from './analyticsDisplayPolicy';

import type { AssetRow, EmployeeRow, PeriodEventRow } from './view-model';

function e(
  id: string,
  name: string,
  borrow: number,
  ret: number,
  open = 0
): EmployeeRow {
  return {
    employeeId: id,
    displayName: name,
    employeeCode: '',
    openCount: open,
    periodBorrowCount: borrow,
    periodReturnCount: ret
  };
}

function a(id: string, name: string, borrow: number, ret: number, status = 'AVAILABLE', isOutNow = false, overdue = false): AssetRow {
  return {
    id,
    code: '',
    name,
    status,
    isOutNow,
    currentBorrowerDisplayName: null,
    dueAt: null,
    periodBorrowCount: borrow,
    periodReturnCount: ret,
    openIsOverdue: overdue
  };
}

describe('analyticsDisplayPolicy', () => {
  it('limits are positive integers', () => {
    expect(ANALYTICS_KIOSK_DISPLAY_LIMITS.topRankedEmployees).toBeGreaterThan(0);
    expect(ANALYTICS_KIOSK_DISPLAY_LIMITS.topRankedAssets).toBeGreaterThan(0);
    expect(ANALYTICS_KIOSK_DISPLAY_LIMITS.todayEventsMax).toBeGreaterThan(0);
  });

  it('topRankedEmployees picks highest activity first', () => {
    const rows = [e('1', 'A', 1, 1), e('2', 'B', 5, 0), e('3', 'C', 2, 3)];
    const top = topRankedEmployees(rows, 2);
    expect(top.map((r) => r.displayName)).toEqual(['B', 'C']);
  });

  it('topRankedEmployees tie-breaks by display name', () => {
    const rows = [e('1', 'Z', 2, 2), e('2', 'A', 2, 2)];
    const top = topRankedEmployees(rows, 2);
    expect(top.map((r) => r.displayName)).toEqual(['A', 'Z']);
  });

  it('topRankedAssetsByBorrow sorts by borrow count', () => {
    const rows = [a('a', 'x', 1, 0), a('b', 'y', 9, 1), a('c', 'z', 9, 0)];
    const top = topRankedAssetsByBorrow(rows, 2);
    expect(top.map((r) => r.name)).toEqual(['y', 'z']);
  });

  it('countPeriodEventKinds counts kinds', () => {
    const rows: PeriodEventRow[] = [
      { kind: 'BORROW', eventAt: '2026-04-01T00:00:00.000Z', assetId: '1', assetLabel: 'A', actorDisplayName: null, actorEmployeeId: null },
      { kind: 'RETURN', eventAt: '2026-04-01T01:00:00.000Z', assetId: '1', assetLabel: 'A', actorDisplayName: null, actorEmployeeId: null },
      { kind: 'BORROW', eventAt: '2026-04-01T02:00:00.000Z', assetId: '2', assetLabel: 'B', actorDisplayName: null, actorEmployeeId: null }
    ];
    expect(countPeriodEventKinds(rows)).toEqual({ borrowCount: 2, returnCount: 1 });
  });

  it('takeTodayEventsForDisplay keeps newest and caps', () => {
    const rows: PeriodEventRow[] = [
      { kind: 'BORROW', eventAt: '2026-04-01T01:00:00.000Z', assetId: '1', assetLabel: 'A', actorDisplayName: null, actorEmployeeId: null },
      { kind: 'BORROW', eventAt: '2026-04-01T03:00:00.000Z', assetId: '2', assetLabel: 'B', actorDisplayName: null, actorEmployeeId: null },
      { kind: 'RETURN', eventAt: '2026-04-01T02:00:00.000Z', assetId: '3', assetLabel: 'C', actorDisplayName: null, actorEmployeeId: null }
    ];
    const out = takeTodayEventsForDisplay(rows, 2);
    expect(out.map((r) => r.assetLabel)).toEqual(['B', 'C']);
  });

  it('sortPeriodEventsNewestFirst orders desc by eventAt', () => {
    const rows: PeriodEventRow[] = [
      { kind: 'BORROW', eventAt: '2026-04-01T01:00:00.000Z', assetId: '1', assetLabel: 'A', actorDisplayName: null, actorEmployeeId: null },
      { kind: 'BORROW', eventAt: '2026-04-01T03:00:00.000Z', assetId: '2', assetLabel: 'B', actorDisplayName: null, actorEmployeeId: null }
    ];
    const sorted = sortPeriodEventsNewestFirst(rows);
    expect(sorted[0].assetLabel).toBe('B');
  });

  it('periodReturnCompletionRatePercent is null when no borrows', () => {
    expect(periodReturnCompletionRatePercent(0, 3)).toBeNull();
    expect(periodReturnCompletionRatePercent(10, 8)).toBe(80);
  });

  it('summarizeAssetInventory counts buckets', () => {
    const rows: AssetRow[] = [
      a('1', 'A', 0, 0, 'AVAILABLE', false, false),
      a('2', 'B', 1, 1, 'IN_USE', true, false),
      a('3', 'C', 0, 0, 'IN_USE', true, true)
    ];
    const s = summarizeAssetInventory(rows);
    expect(s.availableCount).toBe(1);
    expect(s.inUseCount).toBe(2);
    expect(s.overdueCount).toBe(1);
  });

  it('compareEmployeesByPeriodActivity is stable', () => {
    expect(compareEmployeesByPeriodActivity(e('1', 'A', 0, 0), e('2', 'B', 1, 0))).toBeGreaterThan(0);
  });
});
