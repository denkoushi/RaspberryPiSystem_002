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

/** パレット可視化ボード（サイネージ・可視化ダッシュボード用） */
export interface PalletBoardVisualizationData {
  kind: 'pallet_board';
  machines: Array<{
    machineCd: string;
    machineName: string;
    illustrationUrl: string | null;
    pallets: Array<{
      palletNo: number;
      /** 部品サマリ行 */
      lines: string[];
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
