// Copied from commit 3e2578dbf31cb0e1c3289406d338c234d0c92ec4:
// apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts (private methods).
// Frozen oracle for differential tests: do not fix or modernize this logic.
import { createHash } from 'node:crypto';
import { ApiError } from '../../../../lib/errors.js';
import type { ColumnDefinition, NormalizedRowData } from '../../csv-dashboard.types.js';

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
