import { describe, expect, it } from 'vitest';

import {
  buildExternalizationCandidates,
  buildPartCandidateId,
  computeExternalizationPlan,
  computeReplacementOptions,
  listOutsourcingCandidates,
  simulateExternalizationSelection,
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
    fhinmei: '部品A',
    fkojun: '10',
    resourceCd: 'A01',
    requiredMinutes: 80
  },
  {
    rowId: 'row-2',
    fseiban: 'S001',
    productNo: 'P001',
    fhincd: 'H001',
    fhinmei: '部品A',
    fkojun: '20',
    resourceCd: 'A01',
    requiredMinutes: 40
  },
  {
    rowId: 'row-3',
    fseiban: 'S003',
    productNo: 'P003',
    fhincd: 'H003',
    fhinmei: '部品C',
    fkojun: null,
    resourceCd: 'B02',
    requiredMinutes: 30
  }
];

describe('buildPartCandidateId', () => {
  it('入力順に依存しない安定キーを返す', () => {
    expect(buildPartCandidateId(' S001 ', 'P001', 'H001')).toBe(
      buildPartCandidateId('S001', ' P001', 'H001 ')
    );
  });
});

describe('buildExternalizationCandidates', () => {
  it('同一品番の複数工程を1候補に束ねる', () => {
    const candidates = buildExternalizationCandidates({
      resources: baseResources,
      rows,
      maxCandidates: 10
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.operations).toHaveLength(2);
    expect(candidates[0]?.totalReducedMinutes).toBe(120);
    expect(candidates[0]?.totalOverReductionMinutes).toBe(60);
  });

  it('overResourceCds で対象外資源の候補を落とす', () => {
    const candidates = buildExternalizationCandidates({
      resources: baseResources,
      rows,
      overResourceCds: new Set(['B02']),
      maxCandidates: 10
    });

    expect(candidates).toHaveLength(0);
  });
});

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
    expect(result.summary.remainingOverMinutes).toBe(0);
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
});

describe('simulateExternalizationSelection', () => {
  it('candidateId から部品の全工程を試算する', () => {
    const partCandidates = buildExternalizationCandidates({
      resources: baseResources,
      rows,
      maxCandidates: 10
    });
    const candidateId = partCandidates[0]!.candidateId;

    const result = simulateExternalizationSelection({
      resources: baseResources,
      rows,
      partCandidates,
      selectedCandidateIds: [candidateId]
    });

    expect(result.appliedRows).toHaveLength(2);
    expect(result.summary.remainingOverMinutes).toBe(0);
  });

  it('存在しない candidateId は skippedCandidates に入る', () => {
    const partCandidates = buildExternalizationCandidates({
      resources: baseResources,
      rows,
      maxCandidates: 10
    });

    const result = simulateExternalizationSelection({
      resources: baseResources,
      rows,
      partCandidates,
      selectedCandidateIds: ['missing']
    });

    expect(result.appliedRows).toHaveLength(0);
    expect(result.skippedCandidates).toEqual([{ candidateId: 'missing', reason: 'not_found' }]);
  });
});

describe('computeExternalizationPlan', () => {
  it('超過ゼロになった時点で停止する', () => {
    const plan = computeExternalizationPlan({
      resources: baseResources,
      rows,
      overResourceCds: new Set(['A01'])
    });

    expect(plan.selectedCandidateIds).toHaveLength(1);
    expect(plan.resolved).toBe(true);
    expect(plan.remainingOverMinutes).toBe(0);
  });

  it('候補が足りない場合は resolved false を返す', () => {
    const heavyResources = [
      {
        resourceCd: 'A01',
        requiredMinutes: 500,
        availableMinutes: 100,
        overMinutes: 400,
        classCode: null
      }
    ];
    const smallRows: LoadBalancingRowCandidate[] = [
      {
        rowId: 'only',
        fseiban: 'S1',
        productNo: 'P1',
        fhincd: 'H1',
        fhinmei: '',
        fkojun: '1',
        resourceCd: 'A01',
        requiredMinutes: 50
      }
    ];

    const plan = computeExternalizationPlan({
      resources: heavyResources,
      rows: smallRows,
      overResourceCds: new Set(['A01'])
    });

    expect(plan.resolved).toBe(false);
    expect(plan.remainingOverMinutes).toBeGreaterThan(0);
  });

  it('remainingOverMinutes は選択した超過資源に限定する', () => {
    const resources = [
      {
        resourceCd: 'A01',
        requiredMinutes: 160,
        availableMinutes: 100,
        overMinutes: 60,
        classCode: null
      },
      {
        resourceCd: 'B02',
        requiredMinutes: 150,
        availableMinutes: 100,
        overMinutes: 50,
        classCode: null
      }
    ];
    const focusedRows: LoadBalancingRowCandidate[] = [
      {
        rowId: 'a-only',
        fseiban: 'S1',
        productNo: 'P1',
        fhincd: 'H1',
        fhinmei: '部品A',
        fkojun: '10',
        resourceCd: 'A01',
        requiredMinutes: 60
      }
    ];

    const plan = computeExternalizationPlan({
      resources,
      rows: focusedRows,
      overResourceCds: new Set(['A01'])
    });

    expect(plan.resolved).toBe(true);
    expect(plan.remainingOverMinutes).toBe(0);
    expect(plan.afterResources.find((resource) => resource.resourceCd === 'B02')?.overMinutes).toBe(50);
  });
});

describe('computeReplacementOptions', () => {
  it('除去後に追加できる代替候補を返す', () => {
    const multiPartRows: LoadBalancingRowCandidate[] = [
      ...rows,
      {
        rowId: 'row-4',
        fseiban: 'S004',
        productNo: 'P004',
        fhincd: 'H004',
        fhinmei: '部品D',
        fkojun: '30',
        resourceCd: 'A01',
        requiredMinutes: 70
      }
    ];
    const plan = computeExternalizationPlan({
      resources: baseResources,
      rows: multiPartRows,
      overResourceCds: new Set(['A01'])
    });
    const removeId = plan.selectedCandidateIds[0]!;

    const replacements = computeReplacementOptions({
      resources: baseResources,
      rows: multiPartRows,
      overResourceCds: new Set(['A01']),
      currentSelectedCandidateIds: plan.selectedCandidateIds,
      removeCandidateId: removeId,
      maxOptions: 5
    });

    expect(replacements.removeCandidateId).toBe(removeId);
    expect(replacements.replacementOptions.length).toBeGreaterThan(0);
  });

  it('replacement の remainingOverMinutes も選択超過資源に限定する', () => {
    const resources = [
      {
        resourceCd: 'A01',
        requiredMinutes: 160,
        availableMinutes: 100,
        overMinutes: 60,
        classCode: null
      },
      {
        resourceCd: 'B02',
        requiredMinutes: 150,
        availableMinutes: 100,
        overMinutes: 50,
        classCode: null
      }
    ];
    const focusedRows: LoadBalancingRowCandidate[] = [
      {
        rowId: 'a1',
        fseiban: 'S1',
        productNo: 'P1',
        fhincd: 'H1',
        fhinmei: '部品A',
        fkojun: '10',
        resourceCd: 'A01',
        requiredMinutes: 30
      },
      {
        rowId: 'a2',
        fseiban: 'S2',
        productNo: 'P2',
        fhincd: 'H2',
        fhinmei: '部品B',
        fkojun: '20',
        resourceCd: 'A01',
        requiredMinutes: 60
      },
      {
        rowId: 'a3',
        fseiban: 'S3',
        productNo: 'P3',
        fhincd: 'H3',
        fhinmei: '部品C',
        fkojun: '30',
        resourceCd: 'A01',
        requiredMinutes: 60
      }
    ];
    const plan = computeExternalizationPlan({
      resources,
      rows: focusedRows,
      overResourceCds: new Set(['A01'])
    });
    const removeId = buildPartCandidateId('S1', 'P1', 'H1');

    const replacements = computeReplacementOptions({
      resources,
      rows: focusedRows,
      overResourceCds: new Set(['A01']),
      currentSelectedCandidateIds: plan.selectedCandidateIds,
      removeCandidateId: removeId,
      maxOptions: 5
    });

    expect(replacements.replacementOptions[0]?.resolved).toBe(true);
    expect(replacements.replacementOptions[0]?.remainingOverMinutes).toBe(0);
  });
});
