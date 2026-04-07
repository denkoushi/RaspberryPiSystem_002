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
  | 'kiosk_leader_order_cards';

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
  /** 1ページに並べる資源カード数（4列×2段＝最大8） */
  cardsPerPage?: number;
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
    | KioskLeaderOrderCardsSlotConfig;
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

