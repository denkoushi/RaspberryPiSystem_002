import { parse } from 'csv-parse/sync';
import { ApiError } from '../../lib/errors.js';
import type { ColumnDefinition } from '../csv-dashboard/csv-dashboard.types.js';

export class CsvRowMapper {
  mapBuffer(buffer: Buffer, columnDefinitions: ColumnDefinition[]): Record<string, string>[] {
    const rows = this.parseCsv(buffer);
    if (rows.length === 0) {
      return [];
    }

    const headers = rows[0] || [];
    const columnMapping = this.createColumnMapping(headers, columnDefinitions);

    const mappedRows: Record<string, string>[] = [];
    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const mapped = this.mapRow(row, columnMapping);
      mappedRows.push(mapped);
    }
    return mappedRows;
  }

  private parseCsv(buffer: Buffer): string[][] {
    if (!buffer.length) {
      return [];
    }
    return parse(buffer, {
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      bom: true,
    }) as string[][];
  }

  private createColumnMapping(
    csvHeaders: string[],
    columnDefinitions: ColumnDefinition[]
  ): Array<{ csvIndex: number; internalName: string; required: boolean }> {
    const mapping: Array<{ csvIndex: number; internalName: string; required: boolean }> = [];
    const normalizeHeader = (value: string) => {
      const trimmed = value.replace(/^\uFEFF/, '').replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
      return trimmed.replace(/^"+|"+$/g, '').toLowerCase();
    };

    for (const colDef of columnDefinitions) {
      const csvIndex = csvHeaders.findIndex((header) =>
        colDef.csvHeaderCandidates.some((candidate) =>
          normalizeHeader(header) === normalizeHeader(candidate)
        )
      );

      if (csvIndex === -1) {
        if (colDef.required !== false) {
          const userMessage = [
            'CSVファイルの列構成が設定と一致しません。',
            `見つからなかった列: ${colDef.displayName} (内部名: ${colDef.internalName})`,
            `候補: ${colDef.csvHeaderCandidates.join(', ')}`,
            `実際のCSVヘッダー: ${csvHeaders.slice(0, 5).join(', ')}${csvHeaders.length > 5 ? '...' : ''}`,
            '対応: CSVヘッダー行を確認し、必要なら管理コンソールで列定義の候補を追加してください。'
          ].join(' ');
          throw new ApiError(400, userMessage);
        }
        continue;
      }

      mapping.push({
        csvIndex,
        internalName: colDef.internalName,
        required: colDef.required !== false,
      });
    }

    return mapping;
  }

  private mapRow(
    row: string[],
    mapping: Array<{ csvIndex: number; internalName: string; required: boolean }>
  ): Record<string, string> {
    const mapped: Record<string, string> = {};

    for (const map of mapping) {
      const value = row[map.csvIndex];
      mapped[map.internalName] = value !== undefined ? String(value).trim() : '';
    }

    return mapped;
  }
}
