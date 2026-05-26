import type { LoadBalancingOverviewResource, LoadBalancingRowCandidate } from './types.js';

export type OutsourcingCandidateItem = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fkojun: string | null;
  resourceCd: string;
  rowMinutes: number;
  overReductionMinutes: number;
};

export type ExternalizationCandidateImpact = {
  resourceCd: string;
  reducedMinutes: number;
  overReductionMinutes: number;
};

export type ExternalizationCandidate = {
  candidateId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  operations: LoadBalancingRowCandidate[];
  impactByResource: ExternalizationCandidateImpact[];
  totalReducedMinutes: number;
  totalOverReductionMinutes: number;
  resolvesOverResourceCds: string[];
};

export type OutsourcingCandidatesResult = {
  siteKey: string;
  yearMonth: string;
  mode: 'outsourcing';
  resources: LoadBalancingOverviewResource[];
  candidates: OutsourcingCandidateItem[];
  externalizationCandidates: ExternalizationCandidate[];
};

export type ExternalizationPlanStrategy = 'max_over_reduction' | 'min_count' | 'min_total_minutes';

export type ExternalizationPlanResult = {
  strategy: ExternalizationPlanStrategy;
  selectedCandidateIds: string[];
  beforeResources: OutsourcingEngineResource[];
  afterResources: OutsourcingSimulatedResource[];
  resolved: boolean;
  remainingOverMinutes: number;
  totalReducedMinutes: number;
  totalOverReductionMinutes: number;
};

export type ExternalizationReplacementOption = {
  candidateId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  afterResources: OutsourcingSimulatedResource[];
  resolved: boolean;
  remainingOverMinutes: number;
};

export type ExternalizationReplacementResult = {
  removeCandidateId: string;
  baseSelectedCandidateIds: string[];
  replacementOptions: ExternalizationReplacementOption[];
};

export type OutsourcingSimulatedResource = LoadBalancingOverviewResource & {
  reducedMinutes: number;
};

export type OutsourcingAppliedRow = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fkojun: string | null;
  resourceCd: string;
  rowMinutes: number;
  reducedMinutes: number;
};

export type OutsourcingSkippedRow = {
  rowId: string;
  reason:
    | 'not_found'
    | 'duplicate'
    | 'zero_minutes'
    | 'resource_not_in_overview'
    | 'outside_over_resource_filter';
};

export type OutsourcingSkippedCandidate = {
  candidateId: string;
  reason: 'not_found' | 'duplicate' | 'no_operations' | 'outside_over_resource_filter';
};

export type OutsourcingSimulateSummary = {
  selectedCount: number;
  appliedCount: number;
  skippedCount: number;
  totalReducedMinutes: number;
  remainingOverMinutes: number;
};

export type OutsourcingSimulateResult = {
  siteKey: string;
  yearMonth: string;
  mode: 'outsourcing';
  beforeResources: LoadBalancingOverviewResource[];
  afterResources: OutsourcingSimulatedResource[];
  appliedRows: OutsourcingAppliedRow[];
  skippedRows: OutsourcingSkippedRow[];
  skippedCandidates?: OutsourcingSkippedCandidate[];
  summary: OutsourcingSimulateSummary;
};

export type OutsourcingEngineResource = {
  resourceCd: string;
  requiredMinutes: number;
  availableMinutes: number | null;
  overMinutes: number;
  classCode: string | null;
};

export type OutsourcingEngineInput = {
  resources: OutsourcingEngineResource[];
  rows: LoadBalancingRowCandidate[];
  overResourceCds?: Set<string>;
  maxCandidates?: number;
  selectedRowIds?: string[];
};
