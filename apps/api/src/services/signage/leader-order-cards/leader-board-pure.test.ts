import { describe, expect, it } from 'vitest';

import {
  filterLeaderBoardRowsIncompleteForSignage,
  formatDueDateSignage,
  normalizeConfiguredResourceCds,
  normalizeLeaderBoardRowFromScheduleRow,
  sortLeaderBoardRowsForDisplaySignage,
  toLeaderOrderRowSvgModels,
  type SignageLeaderBoardRow,
} from './leader-board-pure.js';

describe('leader-board-pure', () => {
  it('normalizeConfiguredResourceCds dedupes and uppercases', () => {
    expect(normalizeConfiguredResourceCds([' aa ', 'AA', 'bb'])).toEqual(['AA', 'BB']);
  });

  it('sortLeaderBoardRowsForDisplaySignage orders by processingOrder then due', () => {
    const a: SignageLeaderBoardRow = {
      id: 'a',
      seibanJoinKey: 'S1',
      resourceCd: 'X',
      dueDate: null,
      plannedEndDate: null,
      displayDue: '2026-04-10T00:00:00.000Z',
      fseiban: 'S1',
      productNo: '1',
      fkojun: '1',
      fhincd: '',
      fhinmei: '',
      customerName: '',
      machineName: '',
      machineTypeCode: '',
      plannedQuantity: null,
      processingOrder: 2,
      isCompleted: false,
    };
    const b: SignageLeaderBoardRow = {
      ...a,
      id: 'b',
      processingOrder: 1,
      displayDue: '2026-04-11T00:00:00.000Z',
    };
    const sorted = sortLeaderBoardRowsForDisplaySignage([a, b]);
    expect(sorted.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('normalizeLeaderBoardRowFromScheduleRow converts Prisma Date to ISO due for signage label', () => {
    const normalized = normalizeLeaderBoardRowFromScheduleRow({
      id: 'r1',
      rowData: { FSIGENCD: '080', FSEIBAN: 'S1', progress: '進行中' },
      processingOrder: null,
      note: null,
      dueDate: new Date('2026-05-15T00:00:00.000Z'),
      plannedQuantity: null,
      plannedEndDate: null,
    });
    expect(normalized?.displayDue).toBe('2026-05-15');
    const [svgRow] = toLeaderOrderRowSvgModels(normalized ? [normalized] : [], undefined, () => 'k');
    expect(svgRow.dueLabel).toBe(formatDueDateSignage('2026-05-15'));
    expect(svgRow.dueLabel).not.toBe('—');
  });

  it('normalizeLeaderBoardRowFromScheduleRow falls back to plannedEndDate when manual due is absent', () => {
    const normalized = normalizeLeaderBoardRowFromScheduleRow({
      id: 'r2',
      rowData: { FSIGENCD: '060', FSEIBAN: 'S2', progress: '進行中' },
      processingOrder: null,
      note: null,
      dueDate: null,
      plannedQuantity: null,
      plannedEndDate: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(normalized?.displayDue).toBe('2026-06-01');
    expect(formatDueDateSignage(normalized!.displayDue)).toBe('6/1(月)');
  });

  it('filterLeaderBoardRowsIncompleteForSignage keeps only incomplete rows', () => {
    const incomplete: SignageLeaderBoardRow = {
      id: 'a',
      seibanJoinKey: 'S1',
      resourceCd: 'X',
      dueDate: null,
      plannedEndDate: null,
      displayDue: null,
      fseiban: 'S1',
      productNo: '1',
      fkojun: '1',
      fhincd: '',
      fhinmei: '',
      customerName: '',
      machineName: '',
      machineTypeCode: '',
      plannedQuantity: null,
      processingOrder: null,
      isCompleted: false,
    };
    const complete = { ...incomplete, id: 'b', isCompleted: true };
    expect(filterLeaderBoardRowsIncompleteForSignage([incomplete, complete])).toEqual([incomplete]);
  });

  it('toLeaderOrderRowSvgModels sets hasManualOrder from processingOrder and completion', () => {
    const ranked: SignageLeaderBoardRow = {
      id: 'r1',
      seibanJoinKey: 'S1',
      resourceCd: '060',
      dueDate: null,
      plannedEndDate: null,
      displayDue: '2026-04-10T00:00:00.000Z',
      fseiban: 'S1',
      productNo: '1',
      fkojun: '010',
      fhincd: '',
      fhinmei: '',
      customerName: '',
      machineName: '',
      machineTypeCode: '',
      plannedQuantity: null,
      processingOrder: 3,
      isCompleted: false,
    };
    const unranked = { ...ranked, id: 'r2', processingOrder: null };
    const completedRanked = { ...ranked, id: 'r3', isCompleted: true };

    const models = toLeaderOrderRowSvgModels([ranked, unranked, completedRanked], undefined, () => 'k');
    expect(models[0]?.hasManualOrder).toBe(true);
    expect(models[1]?.hasManualOrder).toBe(false);
    expect(models[2]?.hasManualOrder).toBe(false);
  });
});
