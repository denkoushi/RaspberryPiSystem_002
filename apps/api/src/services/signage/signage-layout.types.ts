/**
 * サイネージレイアウト設定の型定義
 */

export type SignageLayoutType = 'FULL' | 'SPLIT';

export type SignageSlotPosition = 'FULL' | 'LEFT' | 'RIGHT';

export type SignageSlotKind =
  | 'pdf'
  | 'loans'
  | 'csv_dashboard'
  | 'visualization'
  | 'kiosk_progress_overview'
  | 'kiosk_leader_order_cards'
  /** 配膳 Android 部品棚 9枠（JPEG・OrderPlacementBranchState 集約） */
  | 'mobile_placement_parts_shelf_grid'
  /** 自主検査 機種別進捗ボード（JPEG・machineName 集約） */
  | 'self_inspection_machine_board';

/**
 * PDFスロットの設定
 */
export interface PdfSlotConfig {
  pdfId: string;
  displayMode: 'SLIDESHOW' | 'SINGLE';
  slideInterval?: number | null;
}

/**
 * 持出一覧スロットの設定（現時点では設定なし）
 */
export interface LoansSlotConfig {
  // 将来の拡張用
}

/**
 * CSV可視化スロットの設定
 */
export interface CsvDashboardSlotConfig {
  csvDashboardId: string;
}

/**
 * 可視化スロットの設定
 */
export interface VisualizationSlotConfig {
  visualizationDashboardId: string;
}

/**
 * キオスク生産スケジュール進捗一覧（サイネージ JPEG）
 * deviceScopeKey はキオスク端末のスコープと同一の文字列を指定する。
 */
export interface KioskProgressOverviewSlotConfig {
  deviceScopeKey: string;
  slideIntervalSeconds?: number;
  seibanPerPage?: number;
}

/**
 * キオスク順位ボードの資源CDカード（サイネージ JPEG・閲覧専用）
 * deviceScopeKey はキオスク端末のスコープと同一。resourceCds は表示順。
 */
export interface KioskLeaderOrderCardsSlotConfig {
  deviceScopeKey: string;
  resourceCds: string[];
  slideIntervalSeconds?: number;
  /** 1ページに並べる資源カード数（5列×2段＝最大10） */
  cardsPerPage?: number;
}

/**
 * 配膳部品棚 9枠グリッド（サイネージ JPEG）
 * 各ゾーンの表示行数上限。超過分は省略（ヘッダに件数表示）。
 */
export interface MobilePlacementPartsShelfGridSlotConfig {
  maxItemsPerZone?: number;
}

export type SelfInspectionMachineBoardTargetMode =
  | 'manual_machine_name'
  | 'auto_from_leaderboard_status';

/**
 * 自主検査 機種別進捗ボード（サイネージ JPEG）
 * manual: machineName は生産日程の機種名（正規化比較）と一致させる。
 * auto: deviceScopeKey + resourceCds で順位ボード相当の母集団から黄（in_progress）機種を選定。
 */
export interface SelfInspectionMachineBoardSlotConfig {
  /** 未指定時は manual_machine_name（既存互換） */
  targetMode?: SelfInspectionMachineBoardTargetMode;
  /** manual 時必須。auto 時は保存不可 */
  machineName?: string;
  /** manual 推奨 / auto 必須。キオスク端末と同じ deviceScopeKey */
  deviceScopeKey?: string;
  /** auto 時必須。manual 時は保存不可 */
  resourceCds?: string[];
  slideIntervalSeconds?: number;
  partsPerPage?: number;
  detailTopN?: number;
  /** auto 時のみ。連結する機種数上限 */
  maxAutoMachines?: number;
}

/**
 * スロット設定（kindに応じてconfigの型が変わる）
 */
export interface SignageSlot {
  position: SignageSlotPosition;
  kind: SignageSlotKind;
  config:
    | PdfSlotConfig
    | LoansSlotConfig
    | CsvDashboardSlotConfig
    | VisualizationSlotConfig
    | KioskProgressOverviewSlotConfig
    | KioskLeaderOrderCardsSlotConfig
    | MobilePlacementPartsShelfGridSlotConfig
    | SelfInspectionMachineBoardSlotConfig;
}

/**
 * レイアウト設定
 */
export interface SignageLayoutConfig {
  layout: SignageLayoutType;
  slots: SignageSlot[];
}

/**
 * layoutConfigのJSON型（PrismaのJson型として使用）
 */
export type SignageLayoutConfigJson = SignageLayoutConfig | null;

