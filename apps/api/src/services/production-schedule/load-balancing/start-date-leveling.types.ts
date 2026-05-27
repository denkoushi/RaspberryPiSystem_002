import type { WorkCalendarMode } from './work-calendar-policy.js';

export type StartDateLevelingUnallocatedReason =
  | 'missing_planned_start_date'
  | 'missing_effective_due_date'
  | 'no_active_days'
  | 'zero_required_minutes';

export type StartDateLevelingQueryRow = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fkojun: string | null;
  resourceCd: string;
  requiredMinutes: number;
  plannedStartDate: Date | null;
  effectiveDueDate: Date | null;
};

export type StartDateLevelingAllocatedRow = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fkojun: string | null;
  resourceCd: string;
  totalMinutes: number;
  plannedStartDate: string;
  effectiveDueDate: string;
  workCalendarMode: WorkCalendarMode;
};

export type StartDateLevelingUnallocatedRow = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fkojun: string | null;
  resourceCd: string;
  reason: StartDateLevelingUnallocatedReason;
  requiredMinutes: number;
};

export type StartDateLevelingResourceSummary = {
  resourceCd: string;
  workCalendarMode: WorkCalendarMode;
  requiredMinutes: number;
  availableMinutes: number | null;
  overMinutes: number;
};

export type StartDateLevelingCell = {
  resourceCd: string;
  bucketKey: string;
  requiredMinutes: number;
  availableMinutes: number | null;
  overMinutes: number;
};

export type StartDateLevelingMoveInput = {
  rowId: string;
  targetDate: string;
};

export type StartDateLevelingSimulatedMove = {
  rowId: string;
  targetDate: string;
  resourceCd: string;
  movedMinutes: number;
  fromDateKeys: string[];
};

export type StartDateLevelingResult = {
  siteKey: string;
  fromMonth: string;
  toMonth: string;
  bucket: 'month' | 'day';
  focusMonth: string | null;
  months: string[];
  days: string[];
  resources: StartDateLevelingResourceSummary[];
  cells: StartDateLevelingCell[];
  allocatedRows: StartDateLevelingAllocatedRow[];
  unallocatedRows: StartDateLevelingUnallocatedRow[];
  calendarSettings: Array<{ resourceCd: string; workCalendarMode: WorkCalendarMode }>;
  simulatedMoves: StartDateLevelingSimulatedMove[];
};
