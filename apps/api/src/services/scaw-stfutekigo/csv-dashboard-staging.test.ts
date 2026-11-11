import { describe, expect, it } from 'vitest';

import { normalizeRow } from '../csv-dashboard/csv-dashboard-row-normalizer.js';
import type { ColumnDefinition } from '../csv-dashboard/csv-dashboard.types.js';

describe('scawSTFUTEKIGO CSV staging', () => {
  it('keeps source string whitespace and line endings for rawPayload normalization', () => {
    const source = '  original  \r\nline  ';
    const normalized = normalizeRow(
      [source],
      [
        {
          csvIndex: 0,
          internalName: 'remarks',
          columnDef: { dataType: 'string' } as unknown as ColumnDefinition,
        },
      ],
      true
    );

    expect(normalized.remarks).toBe(source);
  });
});
