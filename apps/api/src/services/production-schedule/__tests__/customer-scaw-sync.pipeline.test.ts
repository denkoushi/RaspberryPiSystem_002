import { describe, expect, it } from 'vitest';

import { normalizeCustomerScawMatchKey } from '../customer-scaw-normalize.js';
import { buildFankenmeiKeyToCandidates } from '../customer-scaw-candidates.js';
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
    const cmap = buildFankenmeiKeyToCandidates([{ rowData: { Customer: 'C社', FANKENMEI: '機種X' } }]);
    const out = buildFseibanToCustomerFromProductionRows(
      [
        { id: '1', fseiban: 'S1', fhinmei: '機種X', plannedStartDate: null },
        { id: '2', fseiban: 'S1', fhinmei: '  機種x  ', plannedStartDate: null },
      ],
      cmap
    );
    expect(out.get('S1')).toBe('C社');
    expect(out.size).toBe(1);
  });

  it('buildFseibanToCustomerFromProductionRows: 着手日と FANKENYMD で最寄り顧客を選択', () => {
    const cmap = buildFankenmeiKeyToCandidates([
      { rowData: { Customer: '遠い顧客', FANKENMEI: '標準品', FANKENYMD: '2026-01-01' } },
      { rowData: { Customer: '近い顧客', FANKENMEI: '標準品', FANKENYMD: '2026-04-14' } },
    ]);
    const start = new Date('2026-04-15T00:00:00.000Z');
    const out = buildFseibanToCustomerFromProductionRows(
      [{ id: '1', fseiban: 'FSB12345', fhinmei: '標準品', plannedStartDate: start }],
      cmap
    );
    expect(out.get('FSB12345')).toBe('近い顧客');
  });
});
