import { describe, expect, it } from 'vitest';

import { packPlacement, unpackPlacement } from './snapshot.js';

describe('placement wire tuples', () => {
  it('round trips branch identity, leading zero orders, snapshot fields and display names', () => {
    const row = { id: 'b1', manufacturingOrderBarcodeRaw: '000123', branchNo: 0, shelfCodeRaw: 'A-1',
      updatedAt: '2026-10-28T00:00:00Z', fseiban: 'FS1', fhincd: 'MD1', fhinmei: 'テーブル', productNo: '000123', machineName: 'DAD3350' };
    expect(packPlacement(row)).toEqual(['b1', '000123', 0, 'A-1', '2026-10-28T00:00:00Z', 'FS1', 'MD1', 'テーブル', '000123', 'DAD3350']);
    expect(unpackPlacement(packPlacement(row))).toEqual(row);
  });
});
