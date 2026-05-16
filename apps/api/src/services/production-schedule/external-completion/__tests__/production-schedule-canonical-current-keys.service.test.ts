import { describe, expect, it } from 'vitest';
import type { NormalizedRowData } from '../../../csv-dashboard/csv-dashboard.types.js';
import { ProductionScheduleCanonicalCurrentKeysService } from '../production-schedule-canonical-current-keys.service.js';

describe('ProductionScheduleCanonicalCurrentKeysService', () => {
  it('本体CSV dedupe winner をそのまま正本C current keys にする', async () => {
    const scheduleDedupRows: ReadonlyArray<{ data: NormalizedRowData }> = [
      {
        data: {
          FKOJUN: '100',
          FSIGENCD: '021',
          ProductNo: '1234567890',
        } as NormalizedRowData,
      },
      {
        data: {
          FKOJUN: '200',
          FSIGENCD: '588',
          ProductNo: '0987654321',
        } as NormalizedRowData,
      },
    ];

    const svc = new ProductionScheduleCanonicalCurrentKeysService();

    const keys = await svc.resolveScheduleCsvDisappearanceCanonicalCurrentKeys({ scheduleDedupRows });

    expect(keys).toEqual(['100\t021\t1234567890', '200\t588\t0987654321']);
  });

  it('FKOJUNST 側に無いだけでは current keys から自動除外しない', async () => {
    const scheduleDedupRows: ReadonlyArray<{ data: NormalizedRowData }> = [
      {
        data: {
          FKOJUN: '100',
          FSIGENCD: '021',
          ProductNo: '1234567890',
        } as NormalizedRowData,
      },
    ];

    const svc = new ProductionScheduleCanonicalCurrentKeysService();

    const keys = await svc.resolveScheduleCsvDisappearanceCanonicalCurrentKeys({ scheduleDedupRows });

    expect(keys).toEqual(['100\t021\t1234567890']);
  });

  it('同一キーの重複行は existing helper に従ってユニーク化される', async () => {
    const scheduleDedupRows: ReadonlyArray<{ data: NormalizedRowData }> = [
      {
        data: {
          FKOJUN: '100',
          FSIGENCD: '021',
          ProductNo: '1111111111',
        } as NormalizedRowData,
      },
      {
        data: {
          FKOJUN: '100',
          FSIGENCD: '021',
          ProductNo: '1111111111',
        } as NormalizedRowData,
      },
    ];

    const svc = new ProductionScheduleCanonicalCurrentKeysService();

    const keys = await svc.resolveScheduleCsvDisappearanceCanonicalCurrentKeys({ scheduleDedupRows });

    expect(keys).toEqual(['100\t021\t1111111111']);
  });
});
