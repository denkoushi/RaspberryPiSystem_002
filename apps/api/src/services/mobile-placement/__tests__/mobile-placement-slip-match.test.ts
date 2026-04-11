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
  it('returns ok when both sides match same FSEIBAN and FHINMEI', () => {
    const r = row({ fseiban: 'SAME', fhinmei: 'X' });
    expect(
      evaluateSlipPairMatch({
        transferRow: r,
        actualRow: r,
        transferFhinmeiBarcodeRaw: 'x',
        actualFhinmeiBarcodeRaw: 'X'
      })
    ).toEqual({ ok: true });
  });

  it('returns ng when FSEIBAN differs', () => {
    expect(
      evaluateSlipPairMatch({
        transferRow: row({ fseiban: 'A', fhinmei: 'X' }),
        actualRow: row({ fseiban: 'B', fhinmei: 'X' }),
        transferFhinmeiBarcodeRaw: 'X',
        actualFhinmeiBarcodeRaw: 'X'
      }).ok
    ).toBe(false);
  });

  it('returns transfer FHINMEI mismatch when order resolves but slip name differs', () => {
    expect(
      evaluateSlipPairMatch({
        transferRow: row({ fseiban: 'A', fhinmei: 'NAME-A' }),
        actualRow: row({ fseiban: 'A', fhinmei: 'NAME-A' }),
        transferFhinmeiBarcodeRaw: 'NAME-B',
        actualFhinmeiBarcodeRaw: 'NAME-A'
      })
    ).toEqual({ ok: false, reason: 'TRANSFER_FHINMEI_MISMATCH' });
  });
});
