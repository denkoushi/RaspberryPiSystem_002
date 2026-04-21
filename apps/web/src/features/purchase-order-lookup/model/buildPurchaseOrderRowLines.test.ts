import { describe, expect, it } from 'vitest';

import { buildPurchaseOrderRowLines } from './buildPurchaseOrderRowLines';

import type { PurchaseOrderLookupRowDto } from '../../../api/client';

function row(partial: Partial<PurchaseOrderLookupRowDto> & Pick<PurchaseOrderLookupRowDto, 'seiban'>): PurchaseOrderLookupRowDto {
  return {
    seiban: partial.seiban,
    purchasePartName: partial.purchasePartName ?? 'P',
    masterPartName: partial.masterPartName ?? '',
    machineName: partial.machineName ?? 'M',
    purchasePartCodeRaw: partial.purchasePartCodeRaw ?? 'RAW',
    purchasePartCodeNormalized: partial.purchasePartCodeNormalized ?? 'NORM',
    acceptedQuantity: partial.acceptedQuantity ?? 0,
    plannedStartDate: partial.plannedStartDate ?? null
  };
}

describe('buildPurchaseOrderRowLines', () => {
  it('returns six logical fields in display order (機種→製番→着手日→品名→品番→個数)', () => {
    const vm = buildPurchaseOrderRowLines(
      row({
        seiban: 'BE1',
        machineName: 'MH-X',
        purchasePartName: 'ナット',
        masterPartName: 'ナット',
        purchasePartCodeRaw: 'FH-01',
        acceptedQuantity: 3,
        plannedStartDate: '2026-04-01'
      })
    );
    expect(vm.machineName).toBe('MH-X');
    expect(vm.seiban).toBe('BE1');
    expect(vm.plannedStartDisplay).toBe('2026-04-01');
    expect(vm.purchasePartName).toBe('ナット');
    expect(vm.partCode).toBe('FH-01');
    expect(vm.quantityDisplay).toBe('3');
  });

  it('shows dash for missing plannedStartDate', () => {
    const vm = buildPurchaseOrderRowLines(
      row({
        seiban: 'BE1',
        machineName: 'M',
        purchasePartName: 'P',
        masterPartName: '',
        purchasePartCodeRaw: 'x',
        acceptedQuantity: 1,
        plannedStartDate: null
      })
    );
    expect(vm.plannedStartDisplay).toBe('-');
  });

  it('sets hinmeiSubLine when master differs from purchase name', () => {
    const vm = buildPurchaseOrderRowLines(
      row({
        seiban: 'S',
        purchasePartName: '脚（左）',
        masterPartName: '脚 ASSY L',
        machineName: 'A',
        purchasePartCodeRaw: 'x',
        acceptedQuantity: 1
      })
    );
    expect(vm.hinmeiSubLine).toBe('既存DB: 脚 ASSY L');
  });

  it('omits hinmeiSubLine when master equals purchase name', () => {
    const vm = buildPurchaseOrderRowLines(
      row({
        seiban: 'S',
        purchasePartName: '同一',
        masterPartName: '同一',
        machineName: 'A',
        purchasePartCodeRaw: 'x',
        acceptedQuantity: 2
      })
    );
    expect(vm.hinmeiSubLine).toBeUndefined();
  });

  it('omits hinmeiSubLine when master is empty', () => {
    const vm = buildPurchaseOrderRowLines(
      row({
        seiban: 'S',
        purchasePartName: 'のみ',
        masterPartName: '',
        machineName: 'A',
        purchasePartCodeRaw: 'x',
        acceptedQuantity: 0
      })
    );
    expect(vm.hinmeiSubLine).toBeUndefined();
  });
});
