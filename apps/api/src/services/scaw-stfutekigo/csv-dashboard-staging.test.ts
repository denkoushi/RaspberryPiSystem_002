import { describe, expect, it } from 'vitest';

import { CsvDashboardIngestor } from '../csv-dashboard/csv-dashboard-ingestor.js';

describe('scawSTFUTEKIGO CSV staging', () => {
  it('keeps source string whitespace and line endings for rawPayload normalization', () => {
    const ingestor = new CsvDashboardIngestor() as unknown as {
      normalizeRow(
        row: string[],
        mapping: Array<{
          csvIndex: number;
          internalName: string;
          columnDef: { dataType: string };
        }>,
        preserveSourceStrings: boolean
      ): Record<string, unknown>;
    };
    const source = '  original  \r\nline  ';
    const normalized = ingestor.normalizeRow(
      [source],
      [{ csvIndex: 0, internalName: 'remarks', columnDef: { dataType: 'string' } }],
      true
    );

    expect(normalized.remarks).toBe(source);
  });
});
