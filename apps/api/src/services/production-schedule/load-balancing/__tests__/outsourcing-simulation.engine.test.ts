import { describe, expect, it } from 'vitest';

import {
  listOutsourcingCandidates,
  simulateOutsourcingSelection
} from '../outsourcing-simulation.engine.js';
import type { LoadBalancingRowCandidate } from '../types.js';

const baseResources = [
  {
    resourceCd: 'A01',
    requiredMinutes: 240,
    availableMinutes: 180,
    overMinutes: 60,
    classCode: 'LINE-A'
  },
  {
    resourceCd: 'B02',
    requiredMinutes: 100,
    availableMinutes: 120,
    overMinutes: 0,
    classCode: 'LINE-B'
  }
];

const rows: LoadBalancingRowCandidate[] = [
  {
    rowId: 'row-1',
    fseiban: 'S001',
    productNo: 'P001',
    fhincd: 'H001',
    fkojun: '10',
    resourceCd: 'A01',
    requiredMinutes: 80
  },
  {
    rowId: 'row-2',
    fseiban: 'S002',
    productNo: 'P002',
    fhincd: 'H002',
    fkojun: '20',
    resourceCd: 'A01',
    requiredMinutes: 40
  },
  {
    rowId: 'row-3',
    fseiban: 'S003',
    productNo: 'P003',
    fhincd: 'H003',
    fkojun: null,
    resourceCd: 'B02',
    requiredMinutes: 30
  }
];

describe('listOutsourcingCandidates', () => {
  it('超過資源の工程行だけを効果順で返す', () => {
    const candidates = listOutsourcingCandidates({
      resources: baseResources,
      rows,
      maxCandidates: 10
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.rowId).toBe('row-1');
    expect(candidates[0]?.overReductionMinutes).toBe(60);
    expect(candidates[1]?.rowId).toBe('row-2');
    expect(candidates[1]?.overReductionMinutes).toBe(40);
  });

  it('overResourceCds で候補資源を絞り込む', () => {
    const candidates = listOutsourcingCandidates({
      resources: baseResources,
      rows,
      overResourceCds: new Set(['B02']),
      maxCandidates: 10
    });

    expect(candidates).toHaveLength(0);
  });
});

describe('simulateOutsourcingSelection', () => {
  it('複数 rowId の累積差し引きで超過が下がる', () => {
    const result = simulateOutsourcingSelection({
      resources: baseResources,
      rows,
      selectedRowIds: ['row-1', 'row-2']
    });

    const afterA01 = result.afterResources.find((resource) => resource.resourceCd === 'A01');
    expect(afterA01?.requiredMinutes).toBe(120);
    expect(afterA01?.overMinutes).toBe(0);
    expect(result.summary.totalReducedMinutes).toBe(120);
    expect(result.summary.remainingOverMinutes).toBe(0);
    expect(result.appliedRows).toHaveLength(2);
  });

  it('重複 rowId は二重控除しない', () => {
    const result = simulateOutsourcingSelection({
      resources: baseResources,
      rows,
      selectedRowIds: ['row-1', 'row-1']
    });

    expect(result.appliedRows).toHaveLength(1);
    expect(result.skippedRows).toEqual([{ rowId: 'row-1', reason: 'duplicate' }]);
  });

  it('存在しない rowId は skipped に入る', () => {
    const result = simulateOutsourcingSelection({
      resources: baseResources,
      rows,
      selectedRowIds: ['missing-row']
    });

    expect(result.appliedRows).toHaveLength(0);
    expect(result.skippedRows).toEqual([{ rowId: 'missing-row', reason: 'not_found' }]);
  });
});
