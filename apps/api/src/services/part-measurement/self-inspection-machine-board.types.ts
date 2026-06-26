export type SelfInspectionMachineBoardPartStatus =
  | 'not_started'
  | 'in_progress'
  | 'review_pending'
  | 'completed';

export type SelfInspectionMachineBoardPartItem = {
  scheduleRowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  status: SelfInspectionMachineBoardPartStatus;
  completedEntryCount: number;
  requiredEntryCount: number;
  progressLabel: string;
  dueDate: Date | null;
  isScheduled: boolean;
};

export type SelfInspectionMachineBoardSeibanGroup = {
  fseiban: string;
  dueDate: Date | null;
  parts: SelfInspectionMachineBoardPartItem[];
};

export type HeatstripCellTone = 'center' | 'edge' | 'out_of_tolerance' | 'missing' | 'neutral';

export type HeatstripCell = {
  entryIndex: number;
  entryLabel: string;
  tone: HeatstripCellTone;
  displayValue: string | null;
};

export type HeatstripMeasurementPoint = {
  templateItemId: string;
  label: string;
  cells: HeatstripCell[];
};

export type SelfInspectionMachineBoardAutoTargetPageMeta = {
  /** auto 候補機種数の切り詰め */
  autoTargetTruncated?: boolean;
  /** auto 候補走査の安全上限到達 */
  autoTargetHitScanCap?: boolean;
  autoTargetScanRowCap?: number;
};

export type SelfInspectionMachineBoardSummaryPage = {
  kind: 'summary';
  machineName: string;
  updatedAt: Date;
  scheduled: SelfInspectionMachineBoardSeibanGroup[];
  unscheduled: SelfInspectionMachineBoardSeibanGroup[];
  pageIndex: number;
  pageCount: number;
  scheduleRowCap?: number;
  scheduleRowHasMore?: boolean;
} & SelfInspectionMachineBoardAutoTargetPageMeta;

export type SelfInspectionMachineBoardDetailPage = {
  kind: 'detail';
  machineName: string;
  updatedAt: Date;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  status: SelfInspectionMachineBoardPartStatus;
  progressLabel: string;
  measurementPoints: HeatstripMeasurementPoint[];
  pageIndex: number;
  pageCount: number;
  scheduleRowCap?: number;
  scheduleRowHasMore?: boolean;
} & SelfInspectionMachineBoardAutoTargetPageMeta;

export type SelfInspectionMachineBoardPage =
  | SelfInspectionMachineBoardSummaryPage
  | SelfInspectionMachineBoardDetailPage;

export type SelfInspectionMachineBoardViewModel = {
  machineName: string;
  normalizedMachineName: string;
  updatedAt: Date;
  pages: SelfInspectionMachineBoardPage[];
  totalPages: number;
  scheduleRowCap: number;
  scheduleRowHasMore: boolean;
  loadedScheduleRowCount: number;
};
