import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_KIOSK_DISPLAY_LIMITS,
  ANALYTICS_KIOSK_FULL_LIST_MAX_ROWS,
  compareEmployeesByPeriodActivity,
  countPeriodEventKinds,
  formatAssetRowLabel,
  longestOverdueDays,
  overdueDays,
  previousMonthBorrowChangePercent,
  selectOpenLoansForDisplay,
  periodReturnCompletionRatePercent,
  selectAssetsForDisplay,
  selectEmployeesForDisplay,
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
  it('承認済みの表示上限を維持する', () => {
    expect(ANALYTICS_KIOSK_DISPLAY_LIMITS).toEqual({ topRankedEmployees: 10, topRankedAssets: 10, todayEventsMax: 11, openLoansMax: 11 });
    expect(ANALYTICS_KIOSK_FULL_LIST_MAX_ROWS).toBe(500);
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

  it('selectEmployeesForDisplay returns top N in top mode', () => {
    const rows = [e('1', 'A', 1, 1), e('2', 'B', 5, 0), e('3', 'C', 2, 3)];
    const out = selectEmployeesForDisplay(rows, 2, 'top');
    expect(out.map((r) => r.displayName)).toEqual(['B', 'C']);
  });

  it('selectEmployeesForDisplay returns capped sorted list in all mode', () => {
    const rows = Array.from({ length: ANALYTICS_KIOSK_FULL_LIST_MAX_ROWS + 10 }, (_, i) =>
      e(String(i), `U${String(i).padStart(4, '0')}`, 1, 0)
    );
    const out = selectEmployeesForDisplay(rows, 10, 'all');
    expect(out).toHaveLength(ANALYTICS_KIOSK_FULL_LIST_MAX_ROWS);
  });

  it('selectAssetsForDisplay matches top mode slice', () => {
    const rows = [a('a', 'x', 1, 0), a('b', 'y', 9, 1)];
    expect(selectAssetsForDisplay(rows, 1, 'top').map((r) => r.name)).toEqual(['y']);
  });

  it('takeTodayEventsForDisplay respects mode all', () => {
    const rows: PeriodEventRow[] = [
      { kind: 'BORROW', eventAt: '2026-04-01T01:00:00.000Z', assetId: '1', assetLabel: 'A', actorDisplayName: null, actorEmployeeId: null },
      { kind: 'BORROW', eventAt: '2026-04-01T03:00:00.000Z', assetId: '2', assetLabel: 'B', actorDisplayName: null, actorEmployeeId: null },
      { kind: 'RETURN', eventAt: '2026-04-01T02:00:00.000Z', assetId: '3', assetLabel: 'C', actorDisplayName: null, actorEmployeeId: null }
    ];
    expect(takeTodayEventsForDisplay(rows, 2, 'top').map((r) => r.assetLabel)).toEqual(['B', 'C']);
    expect(takeTodayEventsForDisplay(rows, 2, 'all').map((r) => r.assetLabel)).toEqual(['B', 'C', 'A']);
  });
});

describe('未返却の表示', () => {
  const now = new Date('2026-10-05T12:00:00+09:00');
  const open = (id: string, name: string, dueAt: string | null, overdue = false): AssetRow => ({
    ...a(id, name, 1, 0, 'IN_USE', true, overdue), dueAt
  });

  it('貸出中のみを超過・期限・名称順に取り出し、入力を変更しない', () => {
    const rows = [
      open('unknown', '不明', null),
      open('future', '期限内', '2026-10-06T00:00:00Z'),
      open('over-b', 'B', '2026-10-04T00:00:00Z', true),
      a('returned', '返却済', 1, 1),
      open('over-old', '最古', '2026-10-01T00:00:00Z', true),
      open('over-a', 'A', '2026-10-04T00:00:00Z', true),
      open('invalid', '異常', 'invalid')
    ];
    const original = [...rows];
    expect(selectOpenLoansForDisplay(rows, 'top').map((row) => row.id)).toEqual(['over-old', 'over-a', 'over-b', 'future', 'invalid', 'unknown']);
    expect(rows).toEqual(original);
  });

  it('上位モードは11件、全件は500件まで', () => {
    const rows = Array.from({ length: 510 }, (_, i) => open(String(i), String(i), null));
    expect(selectOpenLoansForDisplay(rows, 'top')).toHaveLength(11);
    expect(selectOpenLoansForDisplay(rows, 'all')).toHaveLength(500);
    expect(selectOpenLoansForDisplay([], 'top')).toEqual([]);
  });

  it.each([
    ['2026-10-05T11:59:59+09:00', 1],
    ['2026-10-04T12:00:00+09:00', 1],
    ['2026-10-04T11:59:59+09:00', 2],
    ['2026-10-01T12:00:00+09:00', 4],
    ['2026-10-05T12:00:00+09:00', 0],
    ['2026-10-06T12:00:00+09:00', 0],
    [null, null],
    ['invalid', null]
  ])('overdueDays(%s) = %s', (dueAt, expected) => {
    expect(overdueDays(dueAt, now)).toBe(expected);
  });

  it('最長超過は貸出中かつ超過扱いの有効な期限だけから算出する', () => {
    const rows = [
      open('1', 'A', '2026-10-04T12:00:00+09:00', true),
      open('2', 'B', '2026-10-01T12:00:00+09:00', true),
      open('3', '不明', null, true),
      open('4', '異常', 'invalid', true),
      open('5', '期限内', '2026-09-01T00:00:00Z'),
      { ...open('6', '返却済', '2026-09-01T00:00:00Z', true), isOutNow: false }
    ];
    expect(longestOverdueDays(rows, now)).toBe(4);
    expect(longestOverdueDays([open('1', '不明', null, true)], now)).toBeNull();
    expect(longestOverdueDays([], now)).toBeNull();
  });

  it('コード・名称の重複と空文字を既存規則で表示する', () => {
    const row = { ...a('id', ' 名称 ', 0, 0), code: ' C-001 ' };
    expect(formatAssetRowLabel(row)).toBe('C-001 名称');
    expect(formatAssetRowLabel({ ...row, code: '名称' })).toBe('名称');
    expect(formatAssetRowLabel({ ...row, name: '' })).toBe('C-001');
    expect(formatAssetRowLabel({ ...row, code: '', name: '' })).toBe('id');
  });
});

describe('前月比', () => {
  const trend = [{ yearMonth: '2025-12', borrowCount: 40, returnCount: 38 }];
  it.each([[50, 25], [30, -25], [40, 0], [0, -100], [41, 3]])('年またぎで持出 %s の前月比は %s%%', (borrow, expected) => {
    expect(previousMonthBorrowChangePercent('2026-01', borrow, trend)).toBe(expected);
  });
  it('日指定・前月なし・前月持出0では表示しない', () => {
    expect(previousMonthBorrowChangePercent('2026-01-05', 50, trend)).toBeNull();
    expect(previousMonthBorrowChangePercent('2026-02', 50, trend)).toBeNull();
    expect(previousMonthBorrowChangePercent('2026-01', 50, [{ ...trend[0], borrowCount: 0 }])).toBeNull();
  });
});
