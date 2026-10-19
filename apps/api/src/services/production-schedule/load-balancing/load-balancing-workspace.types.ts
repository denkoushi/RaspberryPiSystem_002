import type { StartDateLevelingUnallocatedRow } from './start-date-leveling.types.js';
import type { WorkCalendarMode } from './work-calendar-policy.js';

/** 納期を過ぎた未完了の残（日割りせず 1 列にまとめる） */
export const LOAD_BALANCING_LATE_BUCKET = 'late' as const;

export type LoadBalancingWorkspaceBucket = string; // 'YYYY-MM' | 'late'

export type LoadBalancingWorkspaceResource = {
  resourceCd: string;
  classCode: string | null;
  workCalendarMode: WorkCalendarMode;
  /** 基準能力（分）。未設定は null */
  baseCapacityMinutes: number | null;
  /** 月ごとの能力（分）。月次上書き → 基準の順。未設定は null（0 扱いしない） */
  capacityByMonth: Record<string, number | null>;
};

export type LoadBalancingWorkspaceAllocation = {
  bucket: LoadBalancingWorkspaceBucket;
  minutes: number;
};

export type LoadBalancingWorkspaceRow = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  machineName: string;
  resourceCd: string;
  totalMinutes: number;
  plannedStartDate: string;
  effectiveDueDate: string;
  /** 有効納期が今日より前（納期遅れ） */
  late: boolean;
  /** 表示範囲内の月別配分（納期遅れは late 1 件） */
  allocations: LoadBalancingWorkspaceAllocation[];
};

export type LoadBalancingWorkspaceTransferRule = {
  fromClassCode: string;
  toClassCode: string;
  priority: number;
  efficiencyRatio: number;
};

export type LoadBalancingWorkspaceResult = {
  siteKey: string;
  today: string;
  fromMonth: string;
  toMonth: string;
  months: string[];
  resources: LoadBalancingWorkspaceResource[];
  rows: LoadBalancingWorkspaceRow[];
  unallocatedRows: StartDateLevelingUnallocatedRow[];
  transferRules: LoadBalancingWorkspaceTransferRule[];
};

export type LoadBalancingWorkspaceDayResult = {
  siteKey: string;
  month: string;
  resourceCd: string;
  capacityMinutesPerDay: number | null;
  days: Array<{ date: string; requiredMinutes: number }>;
  rowDays: Array<{ rowId: string; date: string; minutes: number }>;
};
