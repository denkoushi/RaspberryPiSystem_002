import { Prisma } from '@prisma/client';
import {
  type ProductionScheduleResourceCategory
} from '@raspi-system/shared-types';

import type { ProductionScheduleCompletionFilter } from '../production-schedule-effective-completion.sql.js';
import type { ProcessChangeResidualMode } from '../leaderboard/leaderboard-process-change-residual.types.js';
import type { LeaderboardPartFooterProcessItem } from '../leaderboard/leaderboard-part-footer-processes.service.js';

export const SELF_INSPECTION_SCHEDULE_SCAN_CHUNK_SIZE = 200;
/** 1 リクエストあたりの生産日程スキャン上限（200 × 50 行） */
export const SELF_INSPECTION_SCHEDULE_MAX_SCAN_PAGES = 50;

export type ProductionScheduleSelfInspectionStatus =
  | 'not_started'
  | 'in_progress'
  | 'review_pending'
  | 'completed';

export type ProductionScheduleRow = {
  id: string;
  /** 生産日程一覧と progress-overview を製番単位で突合するための専用キー。 */
  seibanJoinKey: string | null;
  occurredAt: Date;
  rowData: Prisma.JsonValue;
  processingOrder: number | null;
  globalRank: number | null;
  actualPerPieceMinutes: number | null;
  note: string | null;
  processingType: string | null;
  dueDate: Date | null;
  plannedQuantity: number | null;
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
  resolvedMachineName?: string | null;
  customerName: string | null;
  /** `responseProfile=leaderboard` のとき。部品測定/自主検査テンプレ突合せ用（拠点別 resource policy） */
  partMeasurementProcessGroup?: 'cutting' | 'grinding';
  /** `responseProfile=leaderboard` のとき。自主検査開始に使う active テンプレ ID */
  selfInspectionTemplateId?: string | null;
  hasSelfInspectionDrawing?: boolean;
  selfInspectionStatus?: ProductionScheduleSelfInspectionStatus | null;
  selfInspectionEntryPath?: string | null;
  /** 順位ボード: 機械行の FSIGENSHOYORYO（分）。`+人` OFF 時の表示基準。 */
  machineRequiredMinutes?: number;
  /** 順位ボード: 同一 ProductNo + FKOJUN の FSIGENCD=10 人工数（分）。 */
  laborRequiredMinutes?: number;
  /** display item 契約: 親 CsvDashboardRow.id（未分割・分割共通） */
  sourceRowId?: string;
  /** 分割片 ID。未分割時は null */
  splitId?: string | null;
  splitNo?: number | null;
  splitQuantity?: number | null;
  isSplit?: boolean;
};

export type ProductionScheduleListParams = {
  page: number;
  pageSize: number;
  queryText: string;
  productNos: string[];
  machineName?: string;
  resourceCds: string[];
  assignedOnlyCds: string[];
  resourceCategory?: ProductionScheduleResourceCategory;
  hasNoteOnly: boolean;
  hasDueDateOnly: boolean;
  allowResourceOnly?: boolean;
  locationKey: string;
  siteKey?: string;
  /**
   * `leaderboard`: actual-hours を省略。手動割当を優先し、`resourceCds` がちょうど1件のときは**同一製番の他資源へ展開しない**（カード単位）。2件以上または0件のときは従来どおり製番展開あり。残り枠は納期（補完）で埋める。
   * `resolvedMachineName` は full と同様にバッチ解決する（省略時は full）。
   */
  responseProfile?: 'full' | 'leaderboard';
  /** true のとき自主検査開始可能行だけを返す（生産日程をチャンク走査） */
  selfInspectionEligibleOnly?: boolean;
  /** 順位ボード向け。既定 all で後方互換を維持する。 */
  completionFilter?: ProductionScheduleCompletionFilter;
  /** キオスク順位ボード専用。公開 API ではなくサービス内部で設定する。 */
  processChangeResidualMode?: ProcessChangeResidualMode;
  /** {@link materializeProcessChangeResidualStrongEvidence} を同一リクエスト内 1 回だけ実行した結果。 */
  processChangeResidualStrongEvidenceKeys?: ReadonlySet<string>;
};

export type ProductionScheduleListResult = {
  page: number;
  pageSize: number;
  /** 自主検査候補一覧では全件数を算出しないため省略可 */
  total?: number;
  rows: ProductionScheduleRow[];
  /** `responseProfile=leaderboard` のときのみ。progress-overview を二重取得せず行下工程チップへ供給する。 */
  leaderboardFooterChipsByPartKey?: Record<string, LeaderboardPartFooterProcessItem[]>;
  /** `selfInspectionEligibleOnly` のとき。さらに候補がありうる（走査上限または未走査の日程が残る） */
  hasMore?: boolean;
};
