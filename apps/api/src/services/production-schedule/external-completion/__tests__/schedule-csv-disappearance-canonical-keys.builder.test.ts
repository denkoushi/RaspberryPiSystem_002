import { describe, expect, it } from 'vitest';
import type { NormalizedRowData } from '../../csv-dashboard/csv-dashboard.types.js';
import type { FkojunstMailNormalizedRow } from '../fkojunst-status-mail-sync.pipeline.js';
import {
  buildCanonicalScheduleDisappearanceKeysFromPairedMailSnapshot,
  buildMailStatusTripleKeyFromScheduleRowData,
} from '../schedule-csv-disappearance-canonical-keys.builder.js';

function mailRow(partial: Partial<FkojunstMailNormalizedRow> & Pick<FkojunstMailNormalizedRow, 'fkojun' | 'fkoteicd' | 'fsezono'>): FkojunstMailNormalizedRow {
  return {
    sourceRowId: partial.sourceRowId ?? 's1',
    fkojun: partial.fkojun,
    fkoteicd: partial.fkoteicd,
    fsezono: partial.fsezono,
    statusCode: partial.statusCode ?? 'S',
    sourceUpdatedAt: partial.sourceUpdatedAt ?? new Date('2026-05-01T00:00:00.000Z'),
    hasUnparseableDate: partial.hasUnparseableDate ?? false,
  };
}

describe('schedule-csv-disappearance-canonical-keys.builder', () => {
  it('buildMailStatusTripleKeyFromScheduleRowData builds tab key aligned with mail triple', () => {
    const data = {
      FKOJUN: '100',
      FSIGENCD: '021',
      ProductNo: '1234567890',
    } as NormalizedRowData;
    expect(buildMailStatusTripleKeyFromScheduleRowData(data)).toBe('100\t021\t1234567890');
  });

  it('intersection: only schedule rows with matching mail triple produce external completion keys', () => {
    const scheduleDedupRows = [
      { data: { FKOJUN: '100', FSIGENCD: '021', ProductNo: '1234567890' } as NormalizedRowData },
      { data: { FKOJUN: '200', FSIGENCD: '588', ProductNo: '0987654321' } as NormalizedRowData },
    ];
    const mail = [mailRow({ fkojun: '100', fkoteicd: '021', fsezono: '1234567890' })];
    const keys = buildCanonicalScheduleDisappearanceKeysFromPairedMailSnapshot({
      scheduleDedupRows,
      dedupedMailRowsAtOrBeforeReference: mail,
    });
    expect(keys).toEqual(['100\t021\t1234567890']);
  });

  it('intersection: schedule row not in mail snapshot is excluded from canonical keys', () => {
    const scheduleDedupRows = [
      { data: { FKOJUN: '100', FSIGENCD: '021', ProductNo: '1234567890' } as NormalizedRowData },
    ];
    const keys = buildCanonicalScheduleDisappearanceKeysFromPairedMailSnapshot({
      scheduleDedupRows,
      dedupedMailRowsAtOrBeforeReference: [],
    });
    expect(keys).toEqual([]);
  });
});
