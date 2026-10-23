import { describe, expect, it } from 'vitest';
import { evaluateSlipPairMatch, pickPrimaryScheduleRowForOrder } from '../mobile-placement-slip-match.js';
import type { ProductionScheduleLookupRow } from '../../production-schedule/production-schedule-lookup.service.js';

const row = (over: Partial<ProductionScheduleLookupRow>): ProductionScheduleLookupRow => ({
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

describe('optional part scans', () => {
  it.each([undefined, '', '  '])('accepts matching DB rows without scanned parts (%s)', (parts) => {
    expect(evaluateSlipPairMatch({ transferRow: row({}), actualRow: row({}), transferPartBarcodeRaw: parts, actualPartBarcodeRaw: parts })).toEqual({ ok: true });
  });
  it('does not accept different DB parts when scans are omitted', () => {
    expect(evaluateSlipPairMatch({ transferRow: row({}), actualRow: row({ fhincd: 'OTHER' }) })).toEqual({ ok: false, reason: 'FSEIBAN_OR_PART_PAIR_MISMATCH' });
  });
  it('still checks a single supplied part', () => {
    expect(evaluateSlipPairMatch({ transferRow: row({}), actualRow: row({}), actualPartBarcodeRaw: 'WRONG' })).toEqual({ ok: false, reason: 'ACTUAL_PART_MISMATCH' });
  });
  it('retains missing order and seiban checks without parts', () => {
    expect(evaluateSlipPairMatch({ transferRow: null, actualRow: row({}) })).toEqual({ ok: false, reason: 'TRANSFER_ORDER_UNRESOLVED' });
    expect(evaluateSlipPairMatch({ transferRow: row({}), actualRow: null })).toEqual({ ok: false, reason: 'ACTUAL_ORDER_UNRESOLVED' });
    expect(evaluateSlipPairMatch({ transferRow: row({}), actualRow: row({ fseiban: 'OTHER' }) }).ok).toBe(false);
  });
});
