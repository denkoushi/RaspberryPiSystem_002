export type LoadBalancingOverviewResource = {
  resourceCd: string;
  requiredMinutes: number;
  /** 未設定は null（UIで「—」表示）。計算時は 0 扱い。 */
  availableMinutes: number | null;
  overMinutes: number;
  classCode: string | null;
};

export type LoadBalancingOverviewResult = {
  siteKey: string;
  yearMonth: string;
  resources: LoadBalancingOverviewResource[];
};

export type LoadBalancingRowCandidate = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fkojun: string | null;
  resourceCd: string;
  requiredMinutes: number;
};

export type LoadBalancingSuggestionItem = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fkojun: string | null;
  resourceCdFrom: string;
  resourceCdTo: string;
  rowMinutes: number;
  estimatedReductionMinutesOnSource: number;
  estimatedBurdenMinutesOnDestination: number;
  simulatedSourceOverAfter: number;
  simulatedDestinationOverAfter: number;
  rulePriority: number;
  fromClassCode: string;
  toClassCode: string;
  efficiencyRatio: number;
};
