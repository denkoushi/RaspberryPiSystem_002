import { createHash } from 'crypto';
import { isManufacturingOrderNo } from '@raspi-system/shared-types';
import { parse } from 'csv-parse/sync';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import { parseCsvDashboardDateColumnToUtc } from './csv-dashboard-datetime-parse.js';
import type { ColumnDefinition, NormalizedRowData } from './csv-dashboard.types.js';

/**
 * CSVをパース
 */
export function parseCsv(csvContent: string): string[][] {
  try {
    const records = parse(csvContent, {
      skip_empty_lines: true,
      relax_column_count: true,
    }) as string[][];
    return records;
  } catch (error) {
    throw new ApiError(400, `CSVのパースに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 列マッピングを作成（CSVヘッダー → 内部名）
 */
export function createColumnMapping(
  csvHeaders: string[],
  columnDefinitions: ColumnDefinition[]
): Array<{ csvIndex: number; internalName: string; columnDef: ColumnDefinition }> {
  const mapping: Array<{ csvIndex: number; internalName: string; columnDef: ColumnDefinition }> = [];
  const normalizeHeader = (value: string) => {
    // BOM / 全角空白 / 通常空白 / 両端引用符を除去して比較しやすくする
    const trimmed = value.replace(/^\uFEFF/, '').replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
    return trimmed.replace(/^"+|"+$/g, '').toLowerCase();
  };

  for (const colDef of columnDefinitions) {
    // CSVヘッダーから候補を検索
    const csvIndex = csvHeaders.findIndex((header) =>
      colDef.csvHeaderCandidates.some((candidate) =>
        normalizeHeader(header) === normalizeHeader(candidate)
      )
    );

    if (csvIndex === -1) {
      // 必須列が見つからない場合はエラー
      if (colDef.required !== false) {
        const userMessage = [
          'CSVファイルの列構成が設定と一致しません。',
          `見つからなかった列: ${colDef.displayName} (内部名: ${colDef.internalName})`,
          `候補: ${colDef.csvHeaderCandidates.join(', ')}`,
          '対応: CSVヘッダー行を確認し、必要なら管理コンソールで列定義の候補を追加してください。'
        ].join(' ');
        throw new ApiError(
          400,
          userMessage,
          {
            missingColumn: colDef.displayName,
            internalName: colDef.internalName,
            candidates: colDef.csvHeaderCandidates
          },
          'CSV_HEADER_MISMATCH'
        );
      }
      // オプション列の場合はスキップ
      continue;
    }

    mapping.push({
      csvIndex,
      internalName: colDef.internalName,
      columnDef: colDef,
    });
  }

  return mapping;
}

/**
 * 行データを正規化（CSV列 → 内部名に変換）
 */
export function normalizeRow(
  row: string[],
  columnMapping: Array<{ csvIndex: number; internalName: string; columnDef: ColumnDefinition }>,
  preserveSourceStrings = false
): NormalizedRowData {
  const normalized: NormalizedRowData = {};

  for (const mapping of columnMapping) {
    const sourceValue = row[mapping.csvIndex] ?? '';
    const csvValue = preserveSourceStrings ? sourceValue : sourceValue.trim();
    const colDef = mapping.columnDef;

    // データ型に応じて変換
    let value: unknown = csvValue;
    if (csvValue !== '') {
      switch (colDef.dataType) {
        case 'number': {
          const numValue = Number(csvValue);
          value = isNaN(numValue) ? csvValue : numValue; // 変換失敗時は元の値を保持
          break;
        }
        case 'boolean': {
          const lower = csvValue.toLowerCase();
          value = lower === 'true' || lower === '1' || lower === 'yes';
          break;
        }
        case 'date':
          // 日付は後でparseDateで処理するため、ここでは文字列のまま
          value = csvValue;
          break;
        default:
          value = csvValue;
      }
    }

    normalized[mapping.internalName] = value;
  }

  return normalized;
}

/**
 * 日付列からoccurredAtを抽出
 * - 従来: `YYYY/M/D` または `YYYY/M/D H:M` を Asia/Tokyo としてUTCへ
 * - 拡張: ISO8601 日時（`T` 区切り、`csv-dashboard-datetime-parse` 参照）
 */
export function extractOccurredAt(
  row: string[],
  dateColumnIndex: number,
  context?: {
    dashboardId: string;
    dateColumnName: string | null;
  }
): Date {
  if (dateColumnIndex === -1) {
    // 日付列が指定されていない場合は現在時刻を使用
    return new Date();
  }

  const dateValue = row[dateColumnIndex]?.trim();
  if (!dateValue) {
    return new Date();
  }

  try {
    const utcDate = parseCsvDashboardDateColumnToUtc(dateValue);
    if (!utcDate) {
      logger.warn(
        {
          dateValue,
          dashboardId: context?.dashboardId,
          dateColumnName: context?.dateColumnName,
        },
        '[CsvDashboardIngestor] Invalid date format, using current time'
      );
      return new Date();
    }
    return utcDate;
  } catch (error) {
    logger.warn(
      {
        err: error,
        dateValue,
        dashboardId: context?.dashboardId,
        dateColumnName: context?.dateColumnName,
      },
      '[CsvDashboardIngestor] Failed to parse date, using current time'
    );
    return new Date();
  }
}

/**
 * データハッシュを計算（重複除去用）
 */
export function calculateDataHash(normalized: NormalizedRowData, dedupKeyColumns: string[]): string {
  let hashSource: string;

  if (dedupKeyColumns.length > 0) {
    // 指定されたキー列のみを使用
    const keyValues = dedupKeyColumns
      .map((key) => normalized[key])
      .filter((v) => v !== undefined && v !== null)
      .map((v) => String(v).trim().toLowerCase());
    hashSource = keyValues.join('|');
  } else {
    // 全列を使用
    const allValues = Object.entries(normalized)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => String(v ?? '').trim().toLowerCase());
    hashSource = allValues.join('|');
  }

  return createHash('sha256').update(hashSource).digest('hex');
}

export function validateProductionScheduleRow(normalized: NormalizedRowData, rowIndex: number): void {
  const productNo = String(normalized.ProductNo ?? '').trim();
  if (!isManufacturingOrderNo(productNo)) {
    throw new ApiError(
      400,
      `ProductNoは10桁の数字である必要があります（行: ${rowIndex}）`
    );
  }

  const seiban = String(normalized.FSEIBAN ?? '').trim();
  // 割当がない場合は*のみの8桁も許可（例: ********）
  // 英数字8桁、または*のみの8桁を許可
  const isValidSeiban = /^[A-Za-z0-9]{8}$/.test(seiban) || /^\*{8}$/.test(seiban) || /^[A-Za-z0-9*]{8}$/.test(seiban);
  if (!isValidSeiban || seiban.length !== 8) {
    throw new ApiError(
      400,
      `FSEIBANは英数字8桁である必要があります（割当がない場合は*のみの8桁も可）（行: ${rowIndex} / value: ${seiban} / length: ${seiban.length}）`
    );
  }
}
