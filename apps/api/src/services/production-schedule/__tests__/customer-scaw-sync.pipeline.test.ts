import { describe, expect, it } from 'vitest';

import { normalizeCustomerScawMatchKey } from '../customer-scaw-normalize.js';
import {
  buildFankenmeiToCustomerLastWins,
  buildFseibanToCustomerFromProductionRows,
} from '../customer-scaw-sync.pipeline.js';

describe('customer-scaw sync pipeline helpers', () => {
  it('normalizeCustomerScawMatchKey: NFKC・空白・大文字化', () => {
    expect(normalizeCustomerScawMatchKey('  ｱｲｳ　エオ \n')).toBe('アイウ エオ');
    expect(normalizeCustomerScawMatchKey('abc  de')).toBe('ABC DE');
  });

  it('buildFankenmeiToCustomerLastWins: 同一FANKENMEIは後勝ち', () => {
    const map = buildFankenmeiToCustomerLastWins([
      { rowData: { Customer: 'A社', FANKENMEI: '機種X' } },
      { rowData: { Customer: 'B社', FANKENMEI: '機種X' } },
    ]);
    expect(map.get(normalizeCustomerScawMatchKey('機種X'))).toBe('B社');
  });

  it('buildFseibanToCustomerFromProductionRows: FHINMEI照合・同一製番後勝ち', () => {
    const fank = new Map<string, string>([[normalizeCustomerScawMatchKey('機種X'), 'C社']]);
    const out = buildFseibanToCustomerFromProductionRows(
      [
        { id: '1', fseiban: 'S1', fhinmei: '機種X' },
        { id: '2', fseiban: 'S1', fhinmei: '  機種x  ' },
      ],
      fank
    );
    expect(out.get('S1')).toBe('C社');
    expect(out.size).toBe(1);
  });
});
