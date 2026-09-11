import { describe, expect, it } from 'vitest';

import {
  resolveGrindingPlanningBoardDueDate,
  resolveGrindingPlanningBoardResource,
  sortGrindingPlanningBoardItems
} from '../sortGrindingPlanningBoardItems';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';


const item = (overrides: Partial<GrindingPlanningBoardItem>): GrindingPlanningBoardItem => ({
  itemId: 'row-1',
  kind: 'row',
  itemRevision: 'rev-1',
  version: 1,
  sourceRowId: 'source-1',
  fseiban: '26-1041',
  fhincd: 'P-001',
  fhinmei: '部品',
  machineName: '自動組立機 AX-200',
  productNo: 'P-001',
  processOrder: '10',
  originalResourceCd: '305',
  effectiveResourceCd: null,
  originalDueDate: '2026-09-12',
  effectiveDueDate: null,
  originalRank: null,
  alternateRank: null,
  plannedQuantity: 5,
  requiredMinutes: 20,
  requiredMinutesKnown: true,
  isCompleted: false,
  progress: { completed: 0, total: 1, quantityKnown: false },
  ...overrides
});

describe('sortGrindingPlanningBoardItems', () => {
  it('resource表示の別割当は手動順位を最優先し、未指定を末尾に置く', () => {
    const rows = [
      item({ itemId: 'other-seiban', fseiban: '26-1042', originalDueDate: '2026-09-10', productNo: 'P-000' }),
      item({ itemId: 'rank-2', fseiban: '26-1041', originalDueDate: '2026-09-13', alternateRank: 2 }),
      item({ itemId: 'rank-1-a', fseiban: '26-1041', originalDueDate: '2026-09-13', alternateRank: 1, productNo: 'P-001' }),
      item({ itemId: 'earlier-date', fseiban: '26-1041', originalDueDate: '2026-09-12', alternateRank: 9 }),
      item({ itemId: 'rank-1-b', fseiban: '26-1041', originalDueDate: '2026-09-13', alternateRank: 1, productNo: 'P-002' })
    ];

    expect(sortGrindingPlanningBoardItems(rows, ['26-1041', '26-1042'], 'resource', 'alternate').map((row) => row.itemId)).toEqual([
      'rank-1-a',
      'rank-1-b',
      'rank-2',
      'earlier-date',
      'other-seiban'
    ]);
    expect(sortGrindingPlanningBoardItems(rows, ['26-1041', '26-1042'], 'seiban', 'alternate').map((row) => row.itemId)).toEqual([
      'earlier-date',
      'rank-1-a',
      'rank-1-b',
      'rank-2',
      'other-seiban'
    ]);
  });

  it('uses original values in original mode and alternate fallback values in alternate mode', () => {
    const row = item({
      originalResourceCd: '305',
      effectiveResourceCd: '584',
      originalDueDate: '2026-09-12',
      effectiveDueDate: '2026-09-15'
    });

    expect(resolveGrindingPlanningBoardResource(row, 'original')).toBe('305');
    expect(resolveGrindingPlanningBoardResource(row, 'alternate')).toBe('584');
    expect(resolveGrindingPlanningBoardDueDate(row, 'original')).toBe('2026-09-12');
    expect(resolveGrindingPlanningBoardDueDate(row, 'alternate')).toBe('2026-09-15');
  });

  it('keeps original fallback when alternate override is absent', () => {
    const row = item({ effectiveResourceCd: null, effectiveDueDate: null, originalDueDate: null });
    expect(resolveGrindingPlanningBoardResource(row, 'alternate')).toBe('305');
    expect(resolveGrindingPlanningBoardDueDate(row, 'alternate')).toBeNull();
  });

  it('sorts unknown serials by serial before comparing their dates', () => {
    const rows = [
      item({ itemId: 'unknown-b', fseiban: '26-9999', originalDueDate: '2026-09-10' }),
      item({ itemId: 'unknown-a', fseiban: '26-0001', originalDueDate: '2026-09-20' })
    ];
    expect(sortGrindingPlanningBoardItems(rows, ['26-1041'], 'resource', 'alternate').map((row) => row.itemId)).toEqual([
      'unknown-a',
      'unknown-b'
    ]);
  });
});
