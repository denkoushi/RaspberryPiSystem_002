import { describe, expect, it } from 'vitest';

import {
  allocateRemainingRowLoad,
  assembleLoadBalancingWorkspace,
  assembleLoadBalancingWorkspaceDay
} from '../load-balancing-workspace.assembler.js';
import type { StartDateLevelingQueryRow } from '../start-date-leveling.types.js';
import { parseUtcDateKey } from '../work-calendar-policy.js';

const d = parseUtcDateKey;

function makeRow(overrides: Partial<StartDateLevelingQueryRow> = {}): StartDateLevelingQueryRow {
  return {
    rowId: 'row-1',
    fseiban: 'S1',
    productNo: '1',
    fhincd: 'P1',
    fhinmei: 'ブラケット',
    fkojun: '10',
    resourceCd: '033',
    requiredMinutes: 100,
    plannedStartDate: d('2026-10-05'),
    effectiveDueDate: d('2026-10-09'),
    ...overrides
  };
}

function assemble(queryRows: StartDateLevelingQueryRow[], options: { today?: string; base?: [string, number][] } = {}) {
  return assembleLoadBalancingWorkspace({
    siteKey: '第2工場',
    today: d(options.today ?? '2026-09-30'),
    fromMonth: '2026-09',
    toMonth: '2026-11',
    months: ['2026-09', '2026-10', '2026-11'],
    queryRows,
    machineNameByFseiban: (fseiban) => (fseiban === 'S1' ? 'NVD-5000' : '機種名未登録'),
    baseCapacity: new Map(options.base ?? [['033', 9600]]),
    monthlyCapacityByMonth: new Map([['2026-11', new Map([['033', 4800]])]]),
    classByResource: new Map([
      ['033', 'H'],
      ['034', 'H']
    ]),
    calendarByResource: new Map(),
    transferRules: []
  });
}

describe('allocateRemainingRowLoad', () => {
  it('spreads a future row evenly over its working days', () => {
    const load = allocateRemainingRowLoad({ row: makeRow(), today: d('2026-09-30'), workCalendarMode: 'weekdays' });
    expect(load.kind).toBe('allocated');
    if (load.kind !== 'allocated') return;
    expect(load.daily.map((item) => item.dateKey)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09'
    ]);
    expect(load.daily[0]?.minutes).toBeCloseTo(20, 5);
  });

  it('puts the whole remaining load from today onward when the start date is in the past', () => {
    const load = allocateRemainingRowLoad({
      row: makeRow({ plannedStartDate: d('2026-09-01'), effectiveDueDate: d('2026-10-02') }),
      today: d('2026-09-30'),
      workCalendarMode: 'weekdays'
    });
    if (load.kind !== 'allocated') throw new Error('expected allocated');
    // 9/30, 10/1, 10/2 の 3 稼働日で全量（過去日に配って消さない）
    expect(load.daily.map((item) => item.dateKey)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
    expect(load.daily.reduce((sum, item) => sum + item.minutes, 0)).toBeCloseTo(100, 5);
  });

  it('marks rows whose due date has passed as late with the full remaining load', () => {
    const load = allocateRemainingRowLoad({
      row: makeRow({ plannedStartDate: d('2026-09-01'), effectiveDueDate: d('2026-09-29') }),
      today: d('2026-09-30'),
      workCalendarMode: 'weekdays'
    });
    expect(load).toEqual({ kind: 'late', minutes: 100 });
  });

  it('reports missing dates and zero minutes as unallocated', () => {
    const today = d('2026-09-30');
    expect(
      allocateRemainingRowLoad({ row: makeRow({ plannedStartDate: null }), today, workCalendarMode: 'weekdays' })
    ).toEqual({ kind: 'unallocated', reason: 'missing_planned_start_date' });
    expect(
      allocateRemainingRowLoad({ row: makeRow({ effectiveDueDate: null }), today, workCalendarMode: 'weekdays' })
    ).toEqual({ kind: 'unallocated', reason: 'missing_effective_due_date' });
    expect(
      allocateRemainingRowLoad({ row: makeRow({ requiredMinutes: 0 }), today, workCalendarMode: 'weekdays' })
    ).toEqual({ kind: 'unallocated', reason: 'zero_required_minutes' });
  });
});

describe('assembleLoadBalancingWorkspace', () => {
  it('splits a row across months and keeps capacity null when it is not set', () => {
    const result = assemble(
      [
        makeRow({ plannedStartDate: d('2026-10-29'), effectiveDueDate: d('2026-11-03') }),
        makeRow({ rowId: 'row-2', resourceCd: '091', fseiban: 'S9' })
      ],
      { base: [['033', 9600]] }
    );

    const row = result.rows.find((item) => item.rowId === 'row-1');
    // 10/29,10/30,11/2,11/3 → 10月 2日分 / 11月 2日分
    expect(row?.allocations).toEqual([
      { bucket: '2026-10', minutes: 50 },
      { bucket: '2026-11', minutes: 50 }
    ]);
    expect(row?.machineName).toBe('NVD-5000');
    expect(row?.fhinmei).toBe('ブラケット');

    const r033 = result.resources.find((item) => item.resourceCd === '033');
    expect(r033?.capacityByMonth).toEqual({ '2026-09': 9600, '2026-10': 9600, '2026-11': 4800 });

    const r091 = result.resources.find((item) => item.resourceCd === '091');
    expect(r091?.baseCapacityMinutes).toBeNull();
    expect(r091?.capacityByMonth['2026-10']).toBeNull();
  });

  it('lists late rows in the late bucket and unallocated rows separately', () => {
    const result = assemble([
      makeRow({ rowId: 'late', plannedStartDate: d('2026-08-03'), effectiveDueDate: d('2026-08-31') }),
      makeRow({ rowId: 'nostart', plannedStartDate: null })
    ]);
    expect(result.rows.find((item) => item.rowId === 'late')).toMatchObject({
      late: true,
      allocations: [{ bucket: 'late', minutes: 100 }]
    });
    expect(result.unallocatedRows.map((item) => item.rowId)).toEqual(['nostart']);
  });

  it('drops rows whose remaining load falls entirely outside the range but keeps configured resources', () => {
    const result = assemble([makeRow({ plannedStartDate: d('2027-01-04'), effectiveDueDate: d('2027-01-08') })]);
    expect(result.rows).toHaveLength(0);
    expect(result.resources.map((item) => item.resourceCd)).toEqual(['033', '034']);
  });
});

describe('assembleLoadBalancingWorkspaceDay', () => {
  it('returns daily totals, per-row shares and capacity per working day', () => {
    const result = assembleLoadBalancingWorkspaceDay({
      siteKey: '第2工場',
      today: d('2026-09-30'),
      month: '2026-10',
      resourceCd: '033',
      queryRows: [makeRow(), makeRow({ rowId: 'other', resourceCd: '034' })],
      workCalendarMode: 'weekdays',
      monthlyCapacityMinutes: 9200
    });
    expect(result.days).toHaveLength(22);
    expect(result.capacityMinutesPerDay).toBeCloseTo(9200 / 22, 5);
    expect(result.days.find((day) => day.date === '2026-10-05')?.requiredMinutes).toBeCloseTo(20, 5);
    expect(result.rowDays.every((item) => item.rowId === 'row-1')).toBe(true);
    expect(result.rowDays).toHaveLength(5);
  });
});
