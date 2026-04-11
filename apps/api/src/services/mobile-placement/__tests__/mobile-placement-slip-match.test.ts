import { describe, expect, it } from 'vitest';
import { evaluateSlipPairMatch, pickPrimaryScheduleRowForOrder } from '../mobile-placement-slip-match.js';
import type { PartMeasurementScheduleRowCandidate } from '../../part-measurement/part-measurement-schedule-lookup.service.js';

const row = (over: Partial<PartMeasurementScheduleRowCandidate>): PartMeasurementScheduleRowCandidate => ({
  rowId: 'r1',
  fseiban: 'FS1',
  productNo: 'P1',
  fhincd: 'H1',
  fhinmei: 'NAME-A',
  fsigencd: 'G1',
  fkojun: 1,
  ...over
});

describe('pickPrimaryScheduleRowForOrder', () => {
  it('returns the first schedule row candidate', () => {
    const rows = [row({ rowId: 'first' }), row({ rowId: 'second' })];
    expect(pickPrimaryScheduleRowForOrder(rows)?.rowId).toBe('first');
  });
});

describe('evaluateSlipPairMatch', () => {
  it('returns ok when both sides match same FSEIBAN and FHINCD', () => {
    const r = row({ fseiban: 'SAME', fhincd: 'X-1', fhinmei: 'dummy' });
    expect(
      evaluateSlipPairMatch({
        transferRow: r,
        actualRow: r,
        transferPartBarcodeRaw: 'x-1',
        actualPartBarcodeRaw: 'X-1'
      })
    ).toEqual({ ok: true });
  });

  it('returns ng when FSEIBAN differs', () => {
    expect(
      evaluateSlipPairMatch({
        transferRow: row({ fseiban: 'A', fhincd: 'X-1', fhinmei: 'x' }),
        actualRow: row({ fseiban: 'B', fhincd: 'X-1', fhinmei: 'x' }),
        transferPartBarcodeRaw: 'X-1',
        actualPartBarcodeRaw: 'X-1'
      }).ok
    ).toBe(false);
  });

  it('returns transfer part mismatch when order resolves but slip part differs', () => {
    expect(
      evaluateSlipPairMatch({
        transferRow: row({ fseiban: 'A', fhincd: 'H-1', fhinmei: 'NAME-A' }),
        actualRow: row({ fseiban: 'A', fhincd: 'H-1', fhinmei: 'NAME-A' }),
        transferPartBarcodeRaw: 'H-2',
        actualPartBarcodeRaw: 'H-1'
      })
    ).toEqual({ ok: false, reason: 'TRANSFER_PART_MISMATCH' });
  });
});
