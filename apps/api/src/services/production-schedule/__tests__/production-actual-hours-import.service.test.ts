import { beforeEach, describe, expect, it, vi } from 'vitest';
import iconv from 'iconv-lite';

import { prisma } from '../../../lib/prisma.js';
import { ProductionActualHoursImportService } from '../production-actual-hours-import.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    productionScheduleActualHoursRaw: {
      createMany: vi.fn(),
    },
  },
}));

describe('production-actual-hours-import.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.productionScheduleActualHoursRaw.createMany).mockResolvedValue({ count: 1 } as never);
  });

  it('CP932 CSVを取り込み、無効行を除外する', async () => {
    const csv = [
      'FSEIBAN,FHINCD,FSEZONO,FSEZOSIJISU,FSIGENCD,FSAGYOHOUR,FKOJUN,FSAGYOYMD',
      'SEI001,PART001,LOT1,10,R01,120,10,2024年12月01日',
      'SEI002,PART002,LOT2,0,R02,100,20,2024年12月01日',
    ].join('\n');
    const buffer = iconv.encode(csv, 'cp932');
    const service = new ProductionActualHoursImportService();

    const result = await service.importFromCsv({
      buffer,
      sourceFileKey: 'test-file',
    });

    expect(result.rowsProcessed).toBe(2);
    expect(result.rowsInserted).toBe(1);
    expect(result.rowsIgnored).toBe(1);
    expect(prisma.productionScheduleActualHoursRaw.createMany).toHaveBeenCalledTimes(1);
  });

  it('sourceFileKeyが異なっても同じ行は同一fingerprintになる', async () => {
    const csv = [
      'FSEIBAN,FHINCD,FSEZONO,FSEZOSIJISU,FSIGENCD,FSAGYOHOUR,FKOJUN,FSAGYOYMD',
      'SEI001,PART001,LOT1,10,R01,120,10,2024年12月01日',
    ].join('\n');
    const buffer = iconv.encode(csv, 'cp932');
    const service = new ProductionActualHoursImportService();

    await service.importFromCsv({
      buffer,
      sourceFileKey: 'source-a',
    });
    await service.importFromCsv({
      buffer,
      sourceFileKey: 'source-b',
    });

    const firstCall = vi.mocked(prisma.productionScheduleActualHoursRaw.createMany).mock.calls[0]?.[0] as
      | { data: Array<{ rowFingerprint: string }> }
      | undefined;
    const secondCall = vi.mocked(prisma.productionScheduleActualHoursRaw.createMany).mock.calls[1]?.[0] as
      | { data: Array<{ rowFingerprint: string }> }
      | undefined;

    expect(firstCall?.data[0]?.rowFingerprint).toBeTruthy();
    expect(firstCall?.data[0]?.rowFingerprint).toBe(secondCall?.data[0]?.rowFingerprint);
  });
});
