import { describe, expect, it } from 'vitest';

import { evaluateSlipPairMatch } from './slip-match.js';

const row = { rowId: 'r', fseiban: 'FS1', productNo: '0004099556', fhincd: 'MD004883240', fhinmei: '部品', fsigencd: 'M', fkojun: 1 };

describe('evaluateSlipPairMatch part scans', () => {
  it.each(['0004099556', ' 0004099556\t', '\u30004501238876\u3000'])('ignores order-shaped part scans: %j', (part) => {
    expect(evaluateSlipPairMatch({ transferRow: row, actualRow: row, transferPartBarcodeRaw: part })).toEqual({ ok: true });
    expect(evaluateSlipPairMatch({ transferRow: row, actualRow: row, actualPartBarcodeRaw: part })).toEqual({ ok: true });
    expect(evaluateSlipPairMatch({ transferRow: row, actualRow: row, transferPartBarcodeRaw: part, actualPartBarcodeRaw: part })).toEqual({ ok: true });
  });

  it.each(['MD000006755-002', '000409955', '00040995560', '00040 99556'])('still compares other part values: %j', (part) => {
    expect(evaluateSlipPairMatch({ transferRow: row, actualRow: row, transferPartBarcodeRaw: part })).toEqual({ ok: false, reason: 'TRANSFER_PART_MISMATCH' });
    expect(evaluateSlipPairMatch({ transferRow: row, actualRow: row, actualPartBarcodeRaw: part })).toEqual({ ok: false, reason: 'ACTUAL_PART_MISMATCH' });
  });

  it('keeps matching part codes case-insensitive and trimmed', () => {
    expect(evaluateSlipPairMatch({ transferRow: row, actualRow: row, transferPartBarcodeRaw: ' md004883240 ', actualPartBarcodeRaw: row.fhincd })).toEqual({ ok: true });
  });

  it.each([{ fhincd: 'OTHER' }, { fseiban: 'FS2' }])('still rejects a different schedule pair: %j', (different) => {
    expect(evaluateSlipPairMatch({ transferRow: row, actualRow: { ...row, ...different }, transferPartBarcodeRaw: '0004099556', actualPartBarcodeRaw: '4501238876' }))
      .toEqual({ ok: false, reason: 'FSEIBAN_OR_PART_PAIR_MISMATCH' });
  });
});
