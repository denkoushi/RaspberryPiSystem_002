import { describe, expect, it } from 'vitest';

import {
  buildDailyPlanMetaBySeiban,
  buildFilteredTriageCandidates,
  buildGlobalRankItems,
  buildOrderedFhincds,
  buildOrderedParts,
  buildOrderedPlanItems,
  buildPartsByFhincd,
  buildProposalBySeiban,
  buildSummaryBySeiban,
  buildTriageBySeiban,
  buildTriageCandidates,
  buildTriageZoneCounts,
  filterGlobalRankItems,
  filterPartsByResourceFilter,
  resolveNextSelectedFseiban,
} from '../dueManagementViewModel';

import type {
  ProductionScheduleDueManagementDailyPlanResult,
  ProductionScheduleDueManagementGlobalRankProposal,
  ProductionScheduleDueManagementPartItem,
  ProductionScheduleDueManagementSeibanDetail,
  ProductionScheduleDueManagementSummaryItem,
  ProductionScheduleDueManagementTriageItem,
  ProductionScheduleDueManagementTriageResult,
} from '../../../../api/client';

function summary(fseiban: string): ProductionScheduleDueManagementSummaryItem {
  return {
    fseiban,
    machineName: null,
    dueDate: null,
    partsCount: 1,
    processCount: 1,
    totalRequiredMinutes: 10,
    actualEstimatedMinutes: 0,
    actualCoverageRatio: 0,
  };
}

function triage(
  fseiban: string,
  zone: ProductionScheduleDueManagementTriageItem['zone']
): ProductionScheduleDueManagementTriageItem {
  return {
    ...summary(fseiban),
    zone,
    daysUntilDue: null,
    reasons: [],
    isSelected: false,
    topProcessingType: null,
  };
}

function triageResult(
  danger: string[],
  caution: string[],
  safe: string[]
): ProductionScheduleDueManagementTriageResult {
  return {
    zones: {
      danger: danger.map((s) => triage(s, 'danger')),
      caution: caution.map((s) => triage(s, 'caution')),
      safe: safe.map((s) => triage(s, 'safe')),
    },
    selectedFseibans: [],
  };
}

function part(
  fhincd: string,
  ranks: { current: number | null; suggested: number },
  resourceCds: string[] = []
): ProductionScheduleDueManagementPartItem {
  return {
    productNo: 'P',
    fhincd,
    fhinmei: fhincd,
    note: null,
    processCount: resourceCds.length,
    totalRequiredMinutes: 0,
    processingType: null,
    processingPriority: 0,
    completedProcessCount: 0,
    totalProcessCount: resourceCds.length,
    actualPerPieceMinutes: null,
    actualEstimatedMinutes: 0,
    actualCoverageRatio: 0,
    processes: resourceCds.map((resourceCd, index) => ({
      rowId: `${fhincd}-${index}`,
      resourceCd,
      processOrder: index,
      isCompleted: false,
    })),
    currentPriorityRank: ranks.current,
    suggestedPriorityRank: ranks.suggested,
  };
}

function detail(parts: ProductionScheduleDueManagementPartItem[]): ProductionScheduleDueManagementSeibanDetail {
  return { fseiban: 'S', parts } as unknown as ProductionScheduleDueManagementSeibanDetail;
}

describe('dueManagementViewModel', () => {
  describe('buildTriageCandidates / zone counts', () => {
    it('triage 未取得なら空配列', () => {
      expect(buildTriageCandidates(undefined)).toEqual([]);
    });

    it('danger → caution → safe の順で平坦化する', () => {
      const result = buildTriageCandidates(triageResult(['D1'], ['C1', 'C2'], ['S1']));
      expect(result.map((item) => `${item.zone}:${item.fseiban}`)).toEqual([
        'danger:D1',
        'caution:C1',
        'caution:C2',
        'safe:S1',
      ]);
    });

    it('zone ごとの件数と選択済み件数を数える', () => {
      const candidates = buildTriageCandidates(triageResult(['D1', 'D2'], ['C1'], ['S1', 'S2', 'S3']));
      expect(
        buildTriageZoneCounts({ triageCandidates: candidates, selectedSet: new Set(['D2', 'S3', 'NOT_IN_LIST']) })
      ).toEqual({ danger: 2, caution: 1, safe: 3, total: 6, selected: 2 });
    });

    it('showSelectedOnly のときだけ選択済みに絞る', () => {
      const candidates = buildTriageCandidates(triageResult(['D1'], ['C1'], ['S1']));
      const selectedSet = new Set(['C1']);
      expect(
        buildFilteredTriageCandidates({ triageCandidates: candidates, selectedSet, showSelectedOnly: true }).map(
          (item) => item.fseiban
        )
      ).toEqual(['C1']);
      expect(
        buildFilteredTriageCandidates({ triageCandidates: candidates, selectedSet, showSelectedOnly: false })
      ).toBe(candidates);
    });
  });

  describe('lookup maps', () => {
    it('同じ製番が重複した場合は後勝ちになる', () => {
      const first = summary('S1');
      const second = { ...summary('S1'), partsCount: 99 };
      expect(buildSummaryBySeiban([first, second]).get('S1')?.partsCount).toBe(99);
      expect(buildSummaryBySeiban(undefined).size).toBe(0);
    });

    it('triage を製番で引ける', () => {
      const map = buildTriageBySeiban([triage('A', 'danger'), triage('B', 'safe')]);
      expect(map.get('B')?.zone).toBe('safe');
      expect(map.has('C')).toBe(false);
    });

    it('daily plan の meta を製番ごとに保持する', () => {
      const dailyPlan = {
        items: [
          { fseiban: 'A', isInTodayTriage: true, isCarryover: false },
          { fseiban: 'B', isInTodayTriage: false, isCarryover: true },
        ],
      } as ProductionScheduleDueManagementDailyPlanResult;
      const map = buildDailyPlanMetaBySeiban(dailyPlan);
      expect(map.get('A')).toEqual({ isInTodayTriage: true, isCarryover: false });
      expect(map.get('B')).toEqual({ isInTodayTriage: false, isCarryover: true });
      expect(buildDailyPlanMetaBySeiban(undefined).size).toBe(0);
    });

    it('proposal の score / reasons / 見積を製番で引ける', () => {
      const proposal = {
        items: [
          {
            fseiban: 'A',
            rank: 1,
            score: 87.5,
            estimatedActualMinutes: 120,
            coverageRatio: 0.4,
            breakdown: { reasons: ['納期が近い'] },
          },
        ],
      } as unknown as ProductionScheduleDueManagementGlobalRankProposal;
      expect(buildProposalBySeiban(proposal).get('A')).toEqual({
        score: 87.5,
        reasons: ['納期が近い'],
        estimatedActualMinutes: 120,
        coverageRatio: 0.4,
      });
      expect(buildProposalBySeiban(undefined).size).toBe(0);
    });
  });

  describe('buildOrderedPlanItems', () => {
    it('順序を保ち、daily plan meta が無い製番は選択状態から today / carryover を推定する', () => {
      const items = buildOrderedPlanItems({
        orderedPlanFseibans: ['A', 'B'],
        selectedSet: new Set(['A']),
        summaryBySeiban: buildSummaryBySeiban([summary('A'), summary('B')]),
        triageBySeiban: new Map(),
        dailyPlanMetaBySeiban: new Map(),
      });
      expect(items.map((item) => [item.fseiban, item.meta])).toEqual([
        ['A', { isInTodayTriage: true, isCarryover: false }],
        ['B', { isInTodayTriage: false, isCarryover: true }],
      ]);
      expect(items[0].triage).toBeNull();
      expect(items[0].summary?.fseiban).toBe('A');
    });

    it('summary も triage も無い製番は carryover のときだけ残る', () => {
      const items = buildOrderedPlanItems({
        orderedPlanFseibans: ['SELECTED_NO_DATA', 'UNSELECTED_NO_DATA', 'PLAN_TODAY_NO_DATA'],
        selectedSet: new Set(['SELECTED_NO_DATA']),
        summaryBySeiban: new Map(),
        triageBySeiban: new Map(),
        dailyPlanMetaBySeiban: new Map([['PLAN_TODAY_NO_DATA', { isInTodayTriage: true, isCarryover: false }]]),
      });
      expect(items.map((item) => item.fseiban)).toEqual(['UNSELECTED_NO_DATA']);
    });

    it('daily plan meta は選択状態より優先される', () => {
      const [item] = buildOrderedPlanItems({
        orderedPlanFseibans: ['A'],
        selectedSet: new Set(['A']),
        summaryBySeiban: buildSummaryBySeiban([summary('A')]),
        triageBySeiban: new Map(),
        dailyPlanMetaBySeiban: new Map([['A', { isInTodayTriage: false, isCarryover: true }]]),
      });
      expect(item.meta).toEqual({ isInTodayTriage: false, isCarryover: true });
    });
  });

  describe('buildGlobalRankItems / filterGlobalRankItems', () => {
    const triageBySeiban = buildTriageBySeiban([
      triage('D', 'danger'),
      triage('C', 'caution'),
      triage('S', 'safe'),
    ]);

    it('orderedFseibans が undefined なら空', () => {
      expect(
        buildGlobalRankItems({
          orderedFseibans: undefined,
          selectedSet: new Set(),
          summaryBySeiban: new Map(),
          triageBySeiban,
          dailyPlanMetaBySeiban: new Map(),
        })
      ).toEqual([]);
    });

    it('carryover と today が両方 true の meta は carryover 優先で today=false / outOfToday=true にする', () => {
      const items = buildGlobalRankItems({
        orderedFseibans: ['D', 'C', 'S', 'X'],
        selectedSet: new Set(['S']),
        summaryBySeiban: new Map(),
        triageBySeiban,
        dailyPlanMetaBySeiban: new Map([
          ['D', { isInTodayTriage: true, isCarryover: true }],
          ['C', { isInTodayTriage: true, isCarryover: false }],
        ]),
      });
      expect(
        items.map(({ fseiban, isInTodayTriage, isCarryover, isOutOfToday }) => ({
          fseiban,
          isInTodayTriage,
          isCarryover,
          isOutOfToday,
        }))
      ).toEqual([
        { fseiban: 'D', isInTodayTriage: false, isCarryover: true, isOutOfToday: true },
        { fseiban: 'C', isInTodayTriage: true, isCarryover: false, isOutOfToday: false },
        // meta 無し + 選択済み → today
        { fseiban: 'S', isInTodayTriage: true, isCarryover: false, isOutOfToday: false },
        // meta 無し + 未選択 → carryover
        { fseiban: 'X', isInTodayTriage: false, isCarryover: true, isOutOfToday: true },
      ]);
      expect(items[3].triage).toBeNull();
    });

    it('todayOnly は today の製番のみ、urgentOnly は danger / caution のみを残す', () => {
      const items = buildGlobalRankItems({
        orderedFseibans: ['D', 'C', 'S', 'X'],
        selectedSet: new Set(['S', 'C']),
        summaryBySeiban: new Map(),
        triageBySeiban,
        dailyPlanMetaBySeiban: new Map(),
      });
      expect(filterGlobalRankItems({ globalRankItems: items, filter: 'todayOnly' }).map((i) => i.fseiban)).toEqual([
        'C',
        'S',
      ]);
      expect(filterGlobalRankItems({ globalRankItems: items, filter: 'urgentOnly' }).map((i) => i.fseiban)).toEqual([
        'D',
        'C',
      ]);
      expect(filterGlobalRankItems({ globalRankItems: items, filter: 'all' })).toBe(items);
    });
  });

  describe('parts ordering', () => {
    it('currentPriorityRank を優先し、未設定は後ろで suggestedPriorityRank 順に並べる', () => {
      const d = detail([
        part('NO_RANK_SUGGEST_2', { current: null, suggested: 2 }),
        part('RANK_2', { current: 2, suggested: 9 }),
        part('NO_RANK_SUGGEST_1', { current: null, suggested: 1 }),
        part('RANK_1', { current: 1, suggested: 8 }),
      ]);
      expect(buildOrderedFhincds(d)).toEqual(['RANK_1', 'RANK_2', 'NO_RANK_SUGGEST_1', 'NO_RANK_SUGGEST_2']);
      expect(buildOrderedFhincds(undefined)).toEqual([]);
    });

    it('currentPriorityRank=0 も設定済みとして扱う', () => {
      const d = detail([part('SUGGEST_0', { current: null, suggested: 0 }), part('RANK_0', { current: 0, suggested: 5 })]);
      expect(buildOrderedFhincds(d)).toEqual(['RANK_0', 'SUGGEST_0']);
    });

    it('元の parts 配列を並べ替えない', () => {
      const parts = [part('B', { current: 2, suggested: 0 }), part('A', { current: 1, suggested: 0 })];
      buildOrderedFhincds(detail(parts));
      expect(parts.map((p) => p.fhincd)).toEqual(['B', 'A']);
    });

    it('buildOrderedParts は存在しない品番を落とす', () => {
      const byFhincd = buildPartsByFhincd(detail([part('A', { current: 1, suggested: 1 })]));
      expect(buildOrderedParts(['MISSING', 'A'], byFhincd).map((p) => p.fhincd)).toEqual(['A']);
    });
  });

  describe('filterPartsByResourceFilter', () => {
    const parts = [
      part('GRIND', { current: null, suggested: 1 }, ['305']),
      part('CUT', { current: null, suggested: 2 }, ['120']),
      part('EXCLUDED_ONLY', { current: null, suggested: 3 }, ['10']),
    ];

    it('資源CD指定は trim 後の完全一致で絞る（カテゴリより優先）', () => {
      expect(
        filterPartsByResourceFilter(parts, { resourceCd: ' 120 ', resourceCategory: 'grinding' }).map((p) => p.fhincd)
      ).toEqual(['CUT']);
    });

    it('grinding は研削資源を含む部品、cutting は研削・除外資源以外を含む部品', () => {
      expect(filterPartsByResourceFilter(parts, { resourceCategory: 'grinding' }).map((p) => p.fhincd)).toEqual([
        'GRIND',
      ]);
      expect(
        filterPartsByResourceFilter(parts, { resourceCategory: 'cutting' }, { cuttingExcludedResourceCds: [' 10 '] }).map(
          (p) => p.fhincd
        )
      ).toEqual(['CUT']);
    });

    it('フィルタ無しは全件', () => {
      expect(filterPartsByResourceFilter(parts, {})).toHaveLength(3);
    });
  });

  describe('resolveNextSelectedFseiban', () => {
    const triageCandidates = [triage('T1', 'danger')];

    it('現在の選択が選択肢に含まれていれば維持する（履歴のみに存在する場合も）', () => {
      expect(
        resolveNextSelectedFseiban({
          selectedFseiban: 'H1',
          orderedPlanFseibans: ['P1'],
          triageCandidates,
          sharedHistory: ['H1'],
        })
      ).toBe('H1');
    });

    it('現在の選択が消えたら plan → triage → 履歴 の先頭へフォールバックする', () => {
      const base = { selectedFseiban: 'GONE', triageCandidates, sharedHistory: ['H1'] };
      expect(resolveNextSelectedFseiban({ ...base, orderedPlanFseibans: ['P1'] })).toBe('P1');
      expect(resolveNextSelectedFseiban({ ...base, orderedPlanFseibans: [] })).toBe('T1');
      expect(resolveNextSelectedFseiban({ ...base, orderedPlanFseibans: [], triageCandidates: [] })).toBe('H1');
      expect(
        resolveNextSelectedFseiban({ selectedFseiban: null, orderedPlanFseibans: [], triageCandidates: [], sharedHistory: [] })
      ).toBeNull();
    });
  });
});
