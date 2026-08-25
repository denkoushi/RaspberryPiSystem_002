export type SelfInspectionMachineBoardPartStatus =
  | 'not_started'
  | 'in_progress'
  | 'pending'
  | 'rejected'
  | 'pass'
  /** 旧 renderer / stored fixture 互換。新 VM は pending/pass を返す。 */
  | 'review_pending'
  | 'completed';

export type SelfInspectionMachineBoardOutcomeStatus =
  | 'rejected'
  | 'pending'
  | 'in_progress'
  | 'pass'
  | 'not_started';

/** 資源CD単位の自主検査進捗。カード内の同一CD行はここへ合算する。 */
export type SelfInspectionMachineBoardResourceProgress = {
  resourceCd: string;
  confirmedEntryCount: number;
  requiredEntryCount: number;
  /** confirmedEntryCount の表示互換別名。 */
  completedEntryCount: number;
  progressLabel: string;
  status: SelfInspectionMachineBoardOutcomeStatus;
  outcome: SelfInspectionMachineBoardOutcomeStatus;
  scheduleRowIds: string[];
};

export type SelfInspectionMachineBoardPartItem = {
  scheduleRowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  status: SelfInspectionMachineBoardPartStatus;
  completedEntryCount: number;
  /** 資源集約後の confirmed 件数。旧単一行では completedEntryCount と同値。 */
  confirmedEntryCount?: number;
  requiredEntryCount: number;
  progressLabel: string;
  dueDate: Date | null;
  isScheduled: boolean;
  /** 新 VM の内部カードキー（旧 summary fixture では省略可）。 */
  cardKey?: string;
  machineName?: string;
  normalizedMachineName?: string;
  resources?: SelfInspectionMachineBoardResourceProgress[];
  resourceCds?: string[];
  scheduleRowIds?: string[];
  outcome?: SelfInspectionMachineBoardOutcomeStatus;
  /** 資源行が複数ページへ分割されたときの 1-based 断片番号。 */
  continuationIndex?: number;
  /** 資源行が複数ページへ分割されたときの断片総数。 */
  continuationCount?: number;
  /** continuationIndex > 1 の続きカードであることを明示する。 */
  isContinuation?: boolean;
};

export type SelfInspectionMachineBoardCard = SelfInspectionMachineBoardPartItem & {
  cardKey: string;
  machineName: string;
  normalizedMachineName: string;
  resources: SelfInspectionMachineBoardResourceProgress[];
  resourceCds: string[];
  scheduleRowIds: string[];
  outcome: SelfInspectionMachineBoardOutcomeStatus;
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
