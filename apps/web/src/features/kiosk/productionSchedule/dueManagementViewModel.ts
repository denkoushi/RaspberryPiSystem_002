import { deriveGlobalRankFlags } from './dueManagement';

import type {
  ProductionScheduleDueManagementDailyPlanResult,
  ProductionScheduleDueManagementGlobalRankProposal,
  ProductionScheduleDueManagementPartItem,
  ProductionScheduleDueManagementSeibanDetail,
  ProductionScheduleDueManagementSummaryItem,
  ProductionScheduleDueManagementTriageItem,
  ProductionScheduleDueManagementTriageResult,
} from '../../../api/client';

type DailyPlanMeta = { isInTodayTriage: boolean; isCarryover: boolean };

export type OrderedPlanItem = {
  fseiban: string;
  summary: ProductionScheduleDueManagementSummaryItem | null;
  triage: ProductionScheduleDueManagementTriageItem | null;
  meta: DailyPlanMeta;
};

export type GlobalRankItem = {
  fseiban: string;
  summary: ProductionScheduleDueManagementSummaryItem | null;
  triage: ProductionScheduleDueManagementTriageItem | null;
  isInTodayTriage: boolean;
  isCarryover: boolean;
  isOutOfToday: boolean;
};

export type ProposalItemMeta = {
  score: number;
  reasons: string[];
  estimatedActualMinutes: number;
  coverageRatio: number;
};

export type TriageZoneCounts = {
  danger: number;
  caution: number;
  safe: number;
  total: number;
  selected: number;
};

export type GlobalRankFilter = 'all' | 'todayOnly' | 'urgentOnly';

export const buildSummaryBySeiban = (
  summaryItems: ProductionScheduleDueManagementSummaryItem[] | undefined
): Map<string, ProductionScheduleDueManagementSummaryItem> => {
  const map = new Map<string, ProductionScheduleDueManagementSummaryItem>();
  (summaryItems ?? []).forEach((item) => map.set(item.fseiban, item));
  return map;
};

export const buildTriageCandidates = (
  triage: ProductionScheduleDueManagementTriageResult | undefined
): ProductionScheduleDueManagementTriageItem[] => {
  if (!triage) return [];
  return [...triage.zones.danger, ...triage.zones.caution, ...triage.zones.safe];
};

export const buildFilteredTriageCandidates = (params: {
  triageCandidates: ProductionScheduleDueManagementTriageItem[];
  selectedSet: Set<string>;
  showSelectedOnly: boolean;
}): ProductionScheduleDueManagementTriageItem[] =>
  params.showSelectedOnly
    ? params.triageCandidates.filter((item) => params.selectedSet.has(item.fseiban))
    : params.triageCandidates;

export const buildTriageZoneCounts = (params: {
  triageCandidates: ProductionScheduleDueManagementTriageItem[];
  selectedSet: Set<string>;
}): TriageZoneCounts => {
  const counts = {
    danger: 0,
    caution: 0,
    safe: 0,
    total: params.triageCandidates.length,
    selected: 0
  };
  params.triageCandidates.forEach((item) => {
    counts[item.zone] += 1;
    if (params.selectedSet.has(item.fseiban)) {
      counts.selected += 1;
    }
  });
  return counts;
};

export const buildTriageBySeiban = (
  triageCandidates: ProductionScheduleDueManagementTriageItem[]
): Map<string, ProductionScheduleDueManagementTriageItem> => {
  const map = new Map<string, ProductionScheduleDueManagementTriageItem>();
  triageCandidates.forEach((item) => map.set(item.fseiban, item));
  return map;
};

export const buildDailyPlanMetaBySeiban = (
  dailyPlan: ProductionScheduleDueManagementDailyPlanResult | undefined
): Map<string, DailyPlanMeta> => {
  const map = new Map<string, DailyPlanMeta>();
  (dailyPlan?.items ?? []).forEach((item) => {
    map.set(item.fseiban, { isInTodayTriage: item.isInTodayTriage, isCarryover: item.isCarryover });
  });
  return map;
};

export const buildOrderedPlanItems = (params: {
  orderedPlanFseibans: string[];
  selectedSet: Set<string>;
  summaryBySeiban: Map<string, ProductionScheduleDueManagementSummaryItem>;
  triageBySeiban: Map<string, ProductionScheduleDueManagementTriageItem>;
  dailyPlanMetaBySeiban: Map<string, DailyPlanMeta>;
}): OrderedPlanItem[] =>
  params.orderedPlanFseibans
    .map((fseiban) => ({
      fseiban,
      summary: params.summaryBySeiban.get(fseiban) ?? null,
      triage: params.triageBySeiban.get(fseiban) ?? null,
      meta: params.dailyPlanMetaBySeiban.get(fseiban) ?? {
        isInTodayTriage: params.selectedSet.has(fseiban),
        isCarryover: !params.selectedSet.has(fseiban),
      },
    }))
    .filter((item) => Boolean(item.summary || item.triage || item.meta.isCarryover));

export const buildGlobalRankItems = (params: {
  orderedFseibans: string[] | undefined;
  selectedSet: Set<string>;
  summaryBySeiban: Map<string, ProductionScheduleDueManagementSummaryItem>;
  triageBySeiban: Map<string, ProductionScheduleDueManagementTriageItem>;
  dailyPlanMetaBySeiban: Map<string, DailyPlanMeta>;
}): GlobalRankItem[] =>
  (params.orderedFseibans ?? []).map((fseiban) => {
    const summary = params.summaryBySeiban.get(fseiban) ?? null;
    const triage = params.triageBySeiban.get(fseiban) ?? null;
    const dailyPlanMeta = params.dailyPlanMetaBySeiban.get(fseiban) ?? null;
    const flags = deriveGlobalRankFlags({
      isInTodayTriage: dailyPlanMeta?.isInTodayTriage ?? params.selectedSet.has(fseiban),
      isCarryover: dailyPlanMeta?.isCarryover ?? !params.selectedSet.has(fseiban),
    });
    return {
      fseiban,
      summary,
      triage,
      isInTodayTriage: flags.isInTodayTriage,
      isCarryover: flags.isCarryover,
      isOutOfToday: flags.isOutOfToday,
    };
  });

export const filterGlobalRankItems = (params: {
  globalRankItems: GlobalRankItem[];
  filter: GlobalRankFilter;
}): GlobalRankItem[] => {
  if (params.filter === 'todayOnly') {
    return params.globalRankItems.filter((item) => item.isInTodayTriage);
  }
  if (params.filter === 'urgentOnly') {
    return params.globalRankItems.filter((item) => item.triage?.zone === 'danger' || item.triage?.zone === 'caution');
  }
  return params.globalRankItems;
};

export const buildProposalBySeiban = (
  proposal: ProductionScheduleDueManagementGlobalRankProposal | undefined
): Map<string, ProposalItemMeta> => {
  const map = new Map<string, ProposalItemMeta>();
  (proposal?.items ?? []).forEach((item) => {
    map.set(item.fseiban, {
      score: item.score,
      reasons: item.breakdown.reasons,
      estimatedActualMinutes: item.estimatedActualMinutes,
      coverageRatio: item.coverageRatio,
    });
  });
  return map;
};

export const buildOrderedFhincds = (
  detail: ProductionScheduleDueManagementSeibanDetail | undefined
): string[] => {
  if (!detail) return [];
  return [...detail.parts]
    .sort((a, b) => {
      if (a.currentPriorityRank !== null && b.currentPriorityRank !== null) {
        return a.currentPriorityRank - b.currentPriorityRank;
      }
      if (a.currentPriorityRank !== null) return -1;
      if (b.currentPriorityRank !== null) return 1;
      return a.suggestedPriorityRank - b.suggestedPriorityRank;
    })
    .map((part) => part.fhincd);
};

export const buildPartsByFhincd = (
  detail: ProductionScheduleDueManagementSeibanDetail | undefined
): Map<string, ProductionScheduleDueManagementPartItem> => {
  const map = new Map<string, ProductionScheduleDueManagementPartItem>();
  (detail?.parts ?? []).forEach((part) => map.set(part.fhincd, part));
  return map;
};

export const buildOrderedParts = (
  orderedFhincds: string[],
  partsByFhincd: Map<string, ProductionScheduleDueManagementPartItem>
): ProductionScheduleDueManagementPartItem[] =>
  orderedFhincds
    .map((fhincd) => partsByFhincd.get(fhincd))
    .filter((part): part is ProductionScheduleDueManagementPartItem => Boolean(part));

export const resolveNextSelectedFseiban = (params: {
  selectedFseiban: string | null;
  orderedPlanFseibans: string[];
  triageCandidates: ProductionScheduleDueManagementTriageItem[];
  sharedHistory: string[];
}): string | null => {
  const selectableSet = new Set<string>([
    ...params.orderedPlanFseibans,
    ...params.triageCandidates.map((item) => item.fseiban),
    ...params.sharedHistory,
  ]);
  if (params.selectedFseiban && selectableSet.has(params.selectedFseiban)) {
    return params.selectedFseiban;
  }
  return (
    params.orderedPlanFseibans[0] ??
    params.triageCandidates[0]?.fseiban ??
    params.sharedHistory[0] ??
    null
  );
};
