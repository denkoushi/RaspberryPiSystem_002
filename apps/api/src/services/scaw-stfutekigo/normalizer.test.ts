import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { normalizeScawStfutekigoRows, ScawStfutekigoValidationError } from './normalizer.js';

const row = (overrides: Record<string, unknown> = {}) => ({
  originDepartmentCode: ' Ａ０１ ',
  originDepartmentName: ' 品質  \r\n部 ',
  quantity: '１２.５０',
  remarks: '  原文  \r\n備考  ',
  nonconformityContent: '内容',
  correctiveContent1: '',
  correctiveContent2: '',
  dispositionContent: '処置',
  discoveredOn: '2026/9/2 10:00',
  sourceUpdatedOn: '2026年9月3日',
  manufacturingOrderNo: ' ０００１２３ab ',
  sourceSeiban: ' 製番-１ ',
  qaIssueCode: ' QA-０１ ',
  nonconformityNo: '  ＮＣ-１  ',
  dispositionOn: '',
  drawingNumber: ' 図-１ ',
  ...overrides,
});
describe('normalizeScawStfutekigoRows', () => {
  it('keeps the source payload while canonicalizing domain values', () => {
    const result = normalizeScawStfutekigoRows([{ rowData: row(), sourceRowOrdinal: 1 }]);
    const normalized = result.rows[0];
    expect(normalized.quantity).toBeInstanceOf(Prisma.Decimal);
    expect(normalized.quantity?.toString()).toBe('12.5');
    expect(normalized.manufacturingOrderNo).toBe('000123AB');
    expect(normalized.originDepartmentCode).toBe('A01');
    expect(normalized.remarks).toBe('原文  \n備考');
    expect(normalized.rawPayload.remarks).toBe('  原文  \r\n備考  ');
    expect(normalized.rawPayload.quantity).toBe('１２.５０');
    expect(normalized.discoveredOn?.toISOString().slice(0, 10)).toBe('2026-09-02');
  });

  it('uses the last row for duplicate nonconformity numbers and records the count', () => {
    const result = normalizeScawStfutekigoRows([
      { rowData: row({ remarks: 'first' }), sourceRowOrdinal: 1 },
      { rowData: row({ remarks: 'last' }), sourceRowOrdinal: 2 },
    ]);
    expect(result.duplicateCount).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].remarks).toBe('last');
    expect(result.rows[0].sourceRowOrdinal).toBe(2);
  });

  it('rejects an empty full snapshot and a missing key', () => {
    expect(() => normalizeScawStfutekigoRows([])).toThrow(ScawStfutekigoValidationError);
    expect(() => normalizeScawStfutekigoRows([{ rowData: { nonconformityNo: 'x' } }])).toThrow(
      ScawStfutekigoValidationError
    );
  });
});
