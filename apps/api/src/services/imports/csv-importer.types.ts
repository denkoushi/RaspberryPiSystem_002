/**
 * CSVインポートタイプ
 */
export type CsvImportType = 'employees' | 'items' | 'measuringInstruments' | 'riggingGears' | 'machines' | 'csvDashboards';

/**
 * CSVインポートターゲット（スケジュール内の1つの対象）
 */
export interface CsvImportTarget {
  type: CsvImportType;
  source: string; // Dropbox用: パス、Gmail用: 件名パターン、CSVダッシュボード用: ダッシュボードID
}

/**
 * インポート結果サマリー
 */
export interface ImportSummary {
  processed: number;
  created: number;
  updated: number;
}

/**
 * CSVインポータインターフェース
 */
export interface CsvImporter {
  /**
   * CSVデータをパースして検証する
   * @param buffer CSVファイルのバッファ
   * @returns パースされた行データの配列
   */
  parse(buffer: Buffer): Promise<unknown[]>;

  /**
   * CSVデータをインポートする
   * @param rows パースされた行データの配列
   * @param replaceExisting 既存データを置き換えるか
   * @param logger ロガー
   * @returns インポート結果サマリー
   */
  import(
    rows: unknown[],
    replaceExisting: boolean,
    logger?: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
  ): Promise<ImportSummary>;

  /**
   * このインポータが扱うデータタイプ
   */
  readonly type: CsvImportType;
}

