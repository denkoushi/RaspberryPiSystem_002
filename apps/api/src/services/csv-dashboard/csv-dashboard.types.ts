import type { CsvDashboardIngestMode, CsvDashboardTemplateType } from '@prisma/client';

/**
 * 列定義の構造
 */
export interface ColumnDefinition {
  internalName: string; // 内部名（プロジェクト内で使用）
  displayName: string; // 表示名（サイネージで表示）
  csvHeaderCandidates: string[]; // CSV列名の候補（複数指定可能、最初に一致したものを使用）
  dataType: 'string' | 'number' | 'date' | 'boolean'; // データ型
  order: number; // 表示順序（CSVの順序に関係なく固定）
  required?: boolean; // 必須かどうか
}

/**
 * テンプレート設定（テーブル形式）
 */
export interface TableTemplateConfig {
  rowsPerPage: number; // 1ページあたりの行数
  fontSize: number; // フォントサイズ（px）
  displayColumns: string[]; // 表示する列の内部名配列（順序も反映）
  columnWidths?: Record<string, number>; // 列幅（px、オプション）
  headerFixed?: boolean; // ヘッダー固定表示（デフォルト: true）
}

/**
 * テンプレート設定（カードグリッド形式）
 */
export interface CardGridTemplateConfig {
  cardsPerPage: number; // 1ページあたりのカード数
  fontSize: number; // フォントサイズ（px）
  displayFields: string[]; // カードに表示する項目の内部名配列
  gridColumns?: number; // グリッドの列数（デフォルト: 3）
  gridRows?: number; // グリッドの行数（デフォルト: 3）
}

/**
 * CSVダッシュボード作成入力
 */
export interface CsvDashboardCreateInput {
  name: string;
  description?: string | null;
  columnDefinitions: ColumnDefinition[];
  dateColumnName?: string | null;
  displayPeriodDays?: number;
  emptyMessage?: string | null;
  ingestMode?: CsvDashboardIngestMode;
  dedupKeyColumns?: string[];
  gmailScheduleId?: string | null;
  templateType?: CsvDashboardTemplateType;
  templateConfig: TableTemplateConfig | CardGridTemplateConfig;
}

/**
 * CSVダッシュボード更新入力
 */
export interface CsvDashboardUpdateInput {
  name?: string;
  description?: string | null;
  columnDefinitions?: ColumnDefinition[];
  dateColumnName?: string | null;
  displayPeriodDays?: number;
  emptyMessage?: string | null;
  ingestMode?: CsvDashboardIngestMode;
  dedupKeyColumns?: string[];
  gmailScheduleId?: string | null;
  templateType?: CsvDashboardTemplateType;
  templateConfig?: TableTemplateConfig | CardGridTemplateConfig;
  enabled?: boolean;
}

/**
 * CSVダッシュボードクエリ
 */
export interface CsvDashboardQuery {
  enabled?: boolean;
  search?: string;
}

/**
 * CSVプレビュー結果
 */
export interface CsvPreviewResult {
  headers: string[]; // CSVの実際のヘッダー行
  sampleRows: Record<string, unknown>[]; // サンプル行（最大10行）
  detectedTypes: Record<string, 'string' | 'number' | 'date' | 'boolean'>; // 検出された型
}

/**
 * CSV行データ（正規化後）
 */
export interface NormalizedRowData {
  [internalName: string]: unknown; // 内部名をキーとしたデータ
}

/**
 * 表示用のページデータ
 */
export interface DashboardPageData {
  pageNumber: number; // ページ番号（1始まり）
  totalPages: number; // 総ページ数
  rows: NormalizedRowData[]; // そのページの行データ
}
