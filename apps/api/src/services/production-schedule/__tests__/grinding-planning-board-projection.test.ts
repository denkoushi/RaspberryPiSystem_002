import { describe, expect, it } from 'vitest';

import {
  buildGrindingPlanningBoardLogicalKey,
  buildGrindingPlanningBoardRowItemId,
  projectGrindingPlanningBoard,
  type GrindingPlanningBoardProjectionOverride,
  type GrindingPlanningBoardProjectionRow,
  type GrindingPlanningBoardProjectionRowDetail
} from '../grinding-planning-board-projection.js';

const sourceRow = (
  overrides: Record<string, unknown> = {},
  id = 'row-1'
): GrindingPlanningBoardProjectionRow => ({
  id,
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  rowData: {
    FSEIBAN: 'S-001',
    ProductNo: '10',
    FHINCD: 'P-001',
    FSIGENCD: 'G-01',
    FKOJUN: '20',
    FHINMEI: '部品A',
    FSIGENSHOYORYO: '100',
    ...overrides
  }
});

const detail = (overrides: Partial<GrindingPlanningBoardProjectionRowDetail> = {}): GrindingPlanningBoardProjectionRowDetail => ({
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  rowNotes: [{ dueDate: new Date('2026-09-10T00:00:00.000Z') }],
  orderSupplements: [{ plannedQuantity: 3, plannedEndDate: null }],
  productionScheduleProgress: { isCompleted: false, updatedAt: new Date('2026-09-01T00:00:00.000Z') },
  productionScheduleExternalCompletion: null,
  orderSplits: [],
  ...overrides
});

const baseParams = (overrides: Partial<Parameters<typeof projectGrindingPlanningBoard>[0]> = {}) => ({
  rows: [sourceRow()],
  details: new Map([['row-1', detail()]]),
  ranks: { rows: new Map(), splits: new Map() },
  overrides: new Map<string, GrindingPlanningBoardProjectionOverride>(),
  category: 'grinding' as const,
  seibanOrder: ['S-001'],
  machineNameBySeiban: new Map([['S-001', '機種A']]),
  isResourceInCategory: (resourceCd: string, category: 'grinding' | 'cutting') =>
    category === 'grinding' && resourceCd.startsWith('G-'),
  ...overrides
});

describe('grinding-planning-board-projection', () => {
  it('uses the exact logical key and the resolved machine/rank maps', () => {
    const params = baseParams({
      ranks: {
        rows: new Map([['row-1', { resourceCd: 'G-01', orderNumber: 4 }]]),
        splits: new Map()
      }
    });
    const result = projectGrindingPlanningBoard(params);
    const item = result.items[0];
    expect(buildGrindingPlanningBoardLogicalKey(params.rows[0]!.rowData)).toBe(
      '["S-001","P-001","G-01","20"]'
    );
    expect(item?.itemId).toBe(buildGrindingPlanningBoardRowItemId(params.rows[0]!.rowData));
    expect(item?.machineName).toBe('機種A');
    expect(item?.originalRank).toBe(4);
    expect(item?.alternateRank).toBeNull();
  });

  it('coerces logical-key values as SQL JSON text and sorts original mode by original fields', () => {
    const first = sourceRow({ ProductNo: 10, FKOJUN: 20 }, 'row-original');
    const second = sourceRow({
      FKOJUN: 30,
      FSIGENSHOYORYO: '50'
    }, 'row-second');
    const result = projectGrindingPlanningBoard(
      baseParams({
        rows: [first, second],
        details: new Map([
          ['row-original', detail()],
          ['row-second', detail({ rowNotes: [{ dueDate: new Date('2026-09-01T00:00:00.000Z') }] })]
        ]),
        overrides: new Map([
          [
            buildGrindingPlanningBoardRowItemId(first.rowData),
            { overrideResourceCd: 'G-02', overrideDueDate: new Date('2026-09-30T00:00:00.000Z'), alternateRank: null, version: 1 }
          ]
        ]),
        allocation: 'original'
      })
    );
    expect(buildGrindingPlanningBoardLogicalKey(first.rowData)).toBe(
      '["S-001","P-001","G-01","20"]'
    );
    expect(result.items.map((item) => item.itemId)).toEqual([
      buildGrindingPlanningBoardRowItemId(second.rowData),
      buildGrindingPlanningBoardRowItemId(first.rowData)
    ]);
  });

  it('does not inherit a parent override into split items and rounds split minutes', () => {
    const splitDetail = detail({
      orderSplits: [
        { id: 'split-1', splitQuantity: 1, dueDate: null, updatedAt: new Date('2026-09-01T00:00:00.000Z') },
        { id: 'split-2', splitQuantity: 2, dueDate: null, updatedAt: new Date('2026-09-01T00:00:00.000Z') }
      ],
      orderSupplements: [{ plannedQuantity: 3, plannedEndDate: null }]
    });
    const parentOverride: GrindingPlanningBoardProjectionOverride = {
      overrideResourceCd: 'G-02',
      overrideDueDate: new Date('2026-09-20T00:00:00.000Z'),
      alternateRank: 1,
      version: 1
    };
    const result = projectGrindingPlanningBoard(
      baseParams({
        details: new Map([['row-1', splitDetail]]),
        overrides: new Map([['row:parent', parentOverride]])
      })
    );
    expect(result.items.map((item) => item.itemId)).toEqual(['split:split-1', 'split:split-2']);
    expect(result.items.map((item) => item.effectiveResourceCd)).toEqual(['G-01', 'G-01']);
    expect(result.items.map((item) => item.alternateRank)).toEqual([null, null]);
    expect(result.items.map((item) => item.requiredMinutes)).toEqual([33, 67]);
  });

  it('keeps a source-category item visible when its effective resource is supplied by the caller', () => {
    const result = projectGrindingPlanningBoard(
      baseParams({
        overrides: new Map([
          [
            buildGrindingPlanningBoardRowItemId(sourceRow().rowData),
            { overrideResourceCd: 'C-01', overrideDueDate: null, alternateRank: null, version: 1 }
          ]
        ])
      })
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.originalResourceCd).toBe('G-01');
    expect(result.items[0]?.effectiveResourceCd).toBe('C-01');
  });

  it('counts logical process progress before filtering and does not multiply it per split', () => {
    const splitDetail = detail({
      orderSplits: [
        { id: 'split-1', splitQuantity: 1, dueDate: null, updatedAt: new Date('2026-09-01T00:00:00.000Z') },
        { id: 'split-2', splitQuantity: 2, dueDate: null, updatedAt: new Date('2026-09-01T00:00:00.000Z') }
      ]
    });
    const result = projectGrindingPlanningBoard(
      baseParams({
        details: new Map([['row-1', splitDetail]]),
        progressRows: [
          { rowId: 'row-1', fseiban: 'S-001', productNo: '10', fhincd: 'P-001', isCompleted: false },
          { rowId: 'row-2', fseiban: 'S-001', productNo: '10', fhincd: 'P-001', isCompleted: true },
          { rowId: 'row-3', fseiban: 'S-001', productNo: '99', fhincd: 'P-001', isCompleted: false }
        ]
      })
    );
    expect(result.items.map((item) => item.progress)).toEqual([
      { completed: 1, total: 3, quantityKnown: false },
      { completed: 1, total: 3, quantityKnown: false }
    ]);
    expect(result.progress.bySeiban.get('S-001')).toEqual({ completed: 1, total: 3 });
  });

  it('counts every unfinished item once in both original and effective resource loads', () => {
    const moved = sourceRow({ FSIGENCD: 'G-01', FKOJUN: '10' }, 'row-moved');
    const unknown = sourceRow({ FSIGENCD: 'G-01', FKOJUN: '30', FSIGENSHOYORYO: 'unknown' }, 'row-unknown');
    const result = projectGrindingPlanningBoard(
      baseParams({
        rows: [moved, unknown],
        details: new Map([
          ['row-moved', detail()],
          ['row-unknown', detail()]
        ]),
        overrides: new Map([
          [
            buildGrindingPlanningBoardRowItemId(moved.rowData),
            { overrideResourceCd: 'G-02', overrideDueDate: null, alternateRank: null, version: 1 }
          ]
        ])
      })
    );
    expect(result.load).toEqual([
      {
        resourceCd: 'G-01',
        originalItemCount: 2,
        alternateItemCount: 1,
        originalRequiredMinutes: 100,
        alternateRequiredMinutes: null,
        unfinishedItemCount: 1,
        requiredMinutes: null,
        unknownItemCount: 1,
        originalUnknownItemCount: 1,
        alternateUnknownItemCount: 1
      },
      {
        resourceCd: 'G-02',
        originalItemCount: 0,
        alternateItemCount: 1,
        originalRequiredMinutes: 0,
        alternateRequiredMinutes: 100,
        unfinishedItemCount: 1,
        requiredMinutes: 100,
        unknownItemCount: 0,
        originalUnknownItemCount: 0,
        alternateUnknownItemCount: 0
      }
    ]);
    expect(result.unknownRequiredMinutesCount).toBe(1);
  });
});
