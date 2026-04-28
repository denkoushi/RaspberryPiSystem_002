export type VisualizationData =
  | SeriesVisualizationData
  | KpiVisualizationData
  | TableVisualizationData
  | PalletBoardVisualizationData;

export interface SeriesVisualizationData {
  kind: 'series';
  labels: string[];
  datasets: Array<{
    label: string;
    values: number[];
    isGood?: boolean;
    color?: string;
  }>;
  metadata?: Record<string, unknown>;
}

export interface KpiVisualizationData {
  kind: 'kpi';
  items: Array<{
    label: string;
    value: number | string;
    unit?: string;
    trend?: 'up' | 'down' | 'flat';
    isGood?: boolean;
    note?: string;
  }>;
  metadata?: Record<string, unknown>;
}

export interface TableVisualizationData {
  kind: 'table';
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
  metadata?: Record<string, unknown>;
}

/** 1スロット先頭部品の表示用（キオスク `PalletVizItemCard` と同系の項目） */
export interface PalletBoardSlotPrimaryItem {
  fhincd: string;
  fhinmei: string;
  fseiban: string;
  machineNameDisplay: string | null;
  plannedStartDateDisplay: string | null;
  plannedQuantity: number | null;
}

/** パレット可視化ボード（サイネージ・可視化ダッシュボード用） */
export interface PalletBoardVisualizationData {
  kind: 'pallet_board';
  machines: Array<{
    machineCd: string;
    machineName: string;
    illustrationUrl: string | null;
    pallets: Array<{
      palletNo: number;
      /** 部品サマリ行（後方互換・複数行連結用） */
      lines: string[];
      /** 空きスロット */
      isEmpty?: boolean;
      /** 先頭部品の構造化表示（空きのときは未設定） */
      primaryItem?: PalletBoardSlotPrimaryItem;
      /** 同一パレット内の次点（サイネJPEGでの横並び用、最大で先頭〜2番目のみ） */
      secondaryItem?: PalletBoardSlotPrimaryItem;
    }>;
  }>;
  metadata?: Record<string, unknown>;
}

export type VisualizationQuery = Record<string, unknown>;

export interface RenderConfig {
  width: number;
  height: number;
  title?: string;
  theme?: 'default' | 'dark';
  colors?: {
    good?: string;
    bad?: string;
    neutral?: string;
  };
  [key: string]: unknown;
}

export interface RenderOutput {
  buffer: Buffer;
  contentType: 'image/jpeg' | 'image/png';
}
