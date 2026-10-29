import { describe, expect, it } from 'vitest';

import { enrichLocalPurchaseRows } from './purchase-enrichment.js';
import { packBasePurchase, unpackBasePurchase } from './snapshot.js';

import type { LocalPurchaseRow, PurchaseEnrichmentTuple } from './snapshot.js';

const row: LocalPurchaseRow = { purchaseOrderNo: '000123', seiban: 'FS1', purchasePartName: 'テーブル',
  purchasePartCodeRaw: 'MD1(A)-001', purchasePartCodeNormalized: 'MD1-001', purchasePartCodeMatchKey: 'MD1',
  acceptedQuantity: 2, masterPartName: '', machineName: '', plannedStartDate: null };

describe('independent purchase display data', () => {
  it('round trips base fields without derived display values', () => {
    expect(unpackBasePurchase(packBasePurchase({ ...row, masterPartName: 'stale', machineName: 'stale' }))).toEqual(row);
  });
  it('keeps match-key / normalized-code / normalized-name priority and earliest dates within each match', () => {
    const enrichment: PurchaseEnrichmentTuple[] = [
      ['match', 'MD1', 'マスタ'], ['normalized', 'MD1-001', 'fallback'], ['machine', 'FS1', '機種'],
      ['date', 'FS1', 'MD1(B)-002', 'other', '2026-11-03', '1', 0],
      ['date', 'FS1', 'MD1(C)-003', 'other', '2026-11-02', '1', 0],
      ['date', 'FS1', 'OTHER', 'テーブル', '2026-10-01', '1', 0],
      ['date', 'FS2', 'MD1', 'other', '2026-09-01', '1', 0]
    ];
    expect(enrichLocalPurchaseRows([row], enrichment)).toEqual([{ ...row, masterPartName: 'マスタ', machineName: '機種', plannedStartDate: '2026-11-02' }]);
    const fallback = { ...row, purchasePartCodeMatchKey: 'old-key', purchasePartCodeNormalized: 'MD1(B)-002'.replace('(B)', '') };
    expect(enrichLocalPurchaseRows([fallback], enrichment)[0].plannedStartDate).toBe('2026-11-03');
    expect(enrichLocalPurchaseRows([{ ...row, purchasePartCodeMatchKey: 'missing', purchasePartCodeNormalized: 'missing' }], enrichment)[0].plannedStartDate).toBe('2026-10-01');
    expect(enrichLocalPurchaseRows([{ ...row, purchasePartCodeMatchKey: 'missing' }], enrichment)[0].masterPartName).toBe('fallback');
    expect(enrichLocalPurchaseRows([row], [])).toEqual([row]);
  });
  it('uses the latest order, then its earliest incomplete process, like the server', () => {
    const date = (d: string, productNo: string, completed: 0 | 1): PurchaseEnrichmentTuple => ['date', 'FS1', 'MD1', '', d, productNo, completed];
    const pick = (items: PurchaseEnrichmentTuple[]) => enrichLocalPurchaseRows([row], items)[0].plannedStartDate;
    expect(pick([date('2026-05-01', '9', 0), date('2026-05-03', '10', 0)])).toBe('2026-05-03');
    expect(pick([date('2026-05-02', '10', 1), date('2026-05-04', '10', 0), date('2026-05-03', '10', 0)])).toBe('2026-05-03');
    expect(pick([date('2026-05-04', '10', 1), date('2026-05-03', '10', 1), date('2026-05-01', '-1', 0)])).toBe('2026-05-03');
    expect(pick([date('2026-05-01', '9007199254740992', 0), date('2026-05-02', '9007199254740993', 0)])).toBe('2026-05-02');
  });
  it('preserves raw FSEIBAN filtering, row order and duplicate purchase lines', () => {
    const enrichment: PurchaseEnrichmentTuple[] = [['date', ' FS1 ', 'MD1', '', '2026-10-01', '1', 0]];
    expect(enrichLocalPurchaseRows([row, row], enrichment)).toEqual([row, row]);
    const padded = { ...row, seiban: ' FS1 ' };
    expect(enrichLocalPurchaseRows([padded], enrichment)[0].plannedStartDate).toBe('2026-10-01');
  });
});
