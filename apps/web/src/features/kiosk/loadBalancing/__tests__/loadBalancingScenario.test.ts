import { describe, expect, it } from 'vitest';

import {
  autoLevelCell,
  buildLoadMatrix,
  listCellRows,
  listTransferDestinations,
  nextBucket,
  readLoad,
  sumOverMinutes,
  type ScenarioAction
} from '../loadBalancingScenario';

import type {
  ProductionScheduleLoadBalancingWorkspaceResource,
  ProductionScheduleLoadBalancingWorkspaceRow
} from '../../../../api/client';

const months = ['2026-10', '2026-11'];

function resource(
  resourceCd: string,
  capacity: number | null,
  classCode: string | null = 'H'
): ProductionScheduleLoadBalancingWorkspaceResource {
  return {
    resourceCd,
    classCode,
    workCalendarMode: 'weekdays',
    baseCapacityMinutes: capacity,
    capacityByMonth: { '2026-10': capacity, '2026-11': capacity }
  };
}

function row(
  rowId: string,
  resourceCd: string,
  allocations: Array<{ bucket: string; minutes: number }>
): ProductionScheduleLoadBalancingWorkspaceRow {
  return {
    rowId,
    fseiban: 'S1',
    productNo: '1',
    fhincd: `P-${rowId}`,
    fhinmei: '部品',
    machineName: 'NVD',
    resourceCd,
    totalMinutes: allocations.reduce((sum, allocation) => sum + allocation.minutes, 0),
    plannedStartDate: '2026-10-01',
    effectiveDueDate: '2026-11-30',
    late: allocations.some((allocation) => allocation.bucket === 'late'),
    allocations
  };
}

const resources = [resource('033', 600), resource('034', 600), resource('091', null, null)];
const rules = [{ fromClassCode: 'H', toClassCode: 'H', priority: 1, efficiencyRatio: 1 }];

describe('nextBucket', () => {
  it('moves late to the first month and stops at the last month', () => {
    expect(nextBucket('late', months)).toBe('2026-10');
    expect(nextBucket('2026-10', months)).toBe('2026-11');
    expect(nextBucket('2026-11', months)).toBeNull();
  });
});

describe('buildLoadMatrix', () => {
  const rows = [
    row('a', '033', [
      { bucket: '2026-10', minutes: 300 },
      { bucket: '2026-11', minutes: 100 }
    ]),
    row('b', '033', [{ bucket: '2026-10', minutes: 500 }])
  ];

  it('sums rows per resource and month', () => {
    const matrix = buildLoadMatrix(rows, [], months);
    expect(readLoad(matrix, '033', '2026-10')).toBe(800);
    expect(readLoad(matrix, '033', '2026-11')).toBe(100);
  });

  it('removes outsourced rows, moves transferred rows with the efficiency ratio and defers one month', () => {
    const actions: ScenarioAction[] = [
      { rowId: 'a', type: 'transfer', toResourceCd: '034', efficiencyRatio: 0.5 },
      { rowId: 'b', type: 'defer', fromBucket: '2026-10' }
    ];
    const matrix = buildLoadMatrix(rows, actions, months);
    expect(readLoad(matrix, '033', '2026-10')).toBe(0);
    expect(readLoad(matrix, '033', '2026-11')).toBe(500);
    expect(readLoad(matrix, '034', '2026-10')).toBe(600);
    expect(readLoad(matrix, '034', '2026-11')).toBe(200);

    const outsourced = buildLoadMatrix(rows, [{ rowId: 'b', type: 'outsource' }], months);
    expect(readLoad(outsourced, '033', '2026-10')).toBe(300);
  });
});

describe('sumOverMinutes', () => {
  it('ignores resources without capacity instead of counting their whole load as over', () => {
    const rows = [row('a', '033', [{ bucket: '2026-10', minutes: 700 }]), row('b', '091', [{ bucket: '2026-10', minutes: 900 }])];
    const matrix = buildLoadMatrix(rows, [], months);
    expect(sumOverMinutes(matrix, resources, months)).toEqual({ overMinutes: 100, overResourceCount: 1 });
  });
});

describe('listTransferDestinations', () => {
  it('lists same-class resources with capacity, the ones that fit first', () => {
    const rows = [row('x', '034', [{ bucket: '2026-10', minutes: 550 }])];
    const matrix = buildLoadMatrix(rows, [], months);
    const destinations = listTransferDestinations({
      sourceResourceCd: '033',
      bucket: '2026-10',
      rowMinutes: 100,
      resources,
      rules,
      matrix
    });
    expect(destinations).toEqual([
      { resourceCd: '034', efficiencyRatio: 1, burdenMinutes: 100, spareMinutes: 50, fits: false }
    ]);
  });
});

describe('listCellRows', () => {
  it('shows rows that left the cell and rows moved into it', () => {
    const rows = [row('a', '033', [{ bucket: '2026-10', minutes: 300 }]), row('b', '034', [{ bucket: '2026-10', minutes: 50 }])];
    const actions: ScenarioAction[] = [
      { rowId: 'a', type: 'outsource' },
      { rowId: 'b', type: 'transfer', toResourceCd: '033', efficiencyRatio: 1 }
    ];
    const cellRows = listCellRows({ rows, actions, months, resourceCd: '033', bucket: '2026-10' });
    expect(cellRows.map((item) => [item.row.rowId, item.originalMinutes, item.placedMinutes, item.movedIn])).toEqual([
      ['a', 300, 0, false],
      ['b', 0, 50, true]
    ]);
  });
});

describe('autoLevelCell', () => {
  it('picks the row closest to the overload and transfers it when the destination has room', () => {
    const rows = [
      row('big', '033', [{ bucket: '2026-10', minutes: 400 }]),
      row('fit', '033', [{ bucket: '2026-10', minutes: 120 }]),
      row('small', '033', [{ bucket: '2026-10', minutes: 180 }])
    ];
    // 700 / 600 → 超過 100。100 以上で最小の 120 を選ぶ
    const actions = autoLevelCell({ rows, actions: [], months, resources, rules, resourceCd: '033', bucket: '2026-10' });
    expect(actions).toEqual([{ rowId: 'fit', type: 'transfer', toResourceCd: '034', efficiencyRatio: 1 }]);
  });

  it('falls back to outsourcing when no destination has room', () => {
    const rows = [
      row('a', '033', [{ bucket: '2026-10', minutes: 700 }]),
      row('full', '034', [{ bucket: '2026-10', minutes: 600 }])
    ];
    const actions = autoLevelCell({ rows, actions: [], months, resources, rules, resourceCd: '033', bucket: '2026-10' });
    expect(actions).toEqual([{ rowId: 'a', type: 'outsource' }]);
  });

  it('does nothing for a resource without capacity', () => {
    const rows = [row('a', '091', [{ bucket: '2026-10', minutes: 700 }])];
    expect(autoLevelCell({ rows, actions: [], months, resources, rules, resourceCd: '091', bucket: '2026-10' })).toEqual([]);
  });
});
