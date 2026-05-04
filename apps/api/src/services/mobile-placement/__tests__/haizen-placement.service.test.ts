import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { listScheduleRowsByProductNo } from '../../part-measurement/part-measurement-schedule-lookup.service.js';
import {
  applyHaizenScan,
  getHaizenPresetShelf,
  listHaizenCurrentPlacements,
  updateHaizenPresetShelf
} from '../haizen-placement.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    clientDevice: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    csvDashboardRow: {
      findFirst: vi.fn()
    },
    haizenCurrentPlacement: {
      findMany: vi.fn()
    },
    $transaction: vi.fn()
  }
}));

vi.mock('../../part-measurement/part-measurement-schedule-lookup.service.js', () => ({
  listScheduleRowsByProductNo: vi.fn()
}));

describe('haizen-placement.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getHaizenPresetShelf は端末のプリセットを返す', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({
      haizenPresetShelfCodeRaw: '  西-北-01  '
    } as never);

    await expect(getHaizenPresetShelf('dev-1')).resolves.toEqual({ shelfCodeRaw: '西-北-01' });
  });

  it('updateHaizenPresetShelf は構造化棚のみ許可する', async () => {
    await expect(
      updateHaizenPresetShelf({ clientDeviceId: 'dev-1', shelfCodeRaw: 'bad' })
    ).rejects.toThrow(ApiError);
    expect(prisma.clientDevice.update).not.toHaveBeenCalled();
  });

  it('updateHaizenPresetShelf は構造化棚を保存する', async () => {
    vi.mocked(prisma.clientDevice.update).mockResolvedValue({} as never);

    await expect(
      updateHaizenPresetShelf({ clientDeviceId: 'dev-1', shelfCodeRaw: '西-北-02' })
    ).resolves.toEqual({ shelfCodeRaw: '西-北-02' });

    expect(prisma.clientDevice.update).toHaveBeenCalledWith({
      where: { id: 'dev-1' },
      data: { haizenPresetShelfCodeRaw: '西-北-02' }
    });
  });

  it('applyHaizenScan は分配番号が範囲外なら 400', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({
      id: 'dev-1',
      haizenPresetShelfCodeRaw: '西-北-01'
    } as never);

    await expect(
      applyHaizenScan({
        clientDeviceId: 'dev-1',
        manufacturingOrderBarcodeRaw: 'P-1',
        distributionNumber: 1000
      })
    ).rejects.toThrow(ApiError);
  });

  it('applyHaizenScan は日程未照合でも履歴と現在値を書く', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({
      id: 'dev-1',
      haizenPresetShelfCodeRaw: '西-北-01'
    } as never);
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([]);

    const updatedAt = new Date('2025-05-01T10:00:00.000Z');
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        haizenScanEvent: {
          create: vi.fn().mockResolvedValue({ id: 'ev-unres' })
        },
        haizenCurrentPlacement: {
          upsert: vi.fn().mockResolvedValue({
            id: 'cur-unres',
            manufacturingOrderBarcodeRaw: 'ORD-X',
            shelfCodeRaw: '西-北-01',
            clientDeviceId: 'dev-1',
            distributionNumber: null,
            csvDashboardRowId: null,
            scheduleSnapshot: Prisma.JsonNull,
            updatedAt
          })
        }
      };
      return fn(tx);
    });

    const result = await applyHaizenScan({
      clientDeviceId: 'dev-1',
      manufacturingOrderBarcodeRaw: ' ORD-X ',
      rawBarcode: 'raw'
    });

    expect(result.resolutionStatus).toBe('UNRESOLVED');
    expect(result.current?.resolutionNote).toBe('UNRESOLVED');
    expect(result.current?.manufacturingOrderBarcodeRaw).toBe('ORD-X');
  });

  it('applyHaizenScan は日程照合できれば RESOLVED でスナップショットを持つ', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({
      id: 'dev-1',
      haizenPresetShelfCodeRaw: '西-北-01'
    } as never);
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([
      {
        rowId: 'row-1',
        fseiban: 'FS1',
        productNo: 'PN1',
        fhincd: 'HC1',
        fhinmei: '品名',
        fsigencd: '',
        fkojun: 1
      }
    ]);

    vi.mocked(prisma.csvDashboardRow.findFirst).mockResolvedValue({
      id: 'row-1',
      rowData: {
        ProductNo: 'PN1',
        FSEIBAN: 'FS1',
        FHINCD: 'HC1',
        FHINMEI: '品名'
      }
    } as never);

    const updatedAt = new Date('2025-05-02T11:00:00.000Z');
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        haizenScanEvent: {
          create: vi.fn().mockResolvedValue({ id: 'ev-res' })
        },
        haizenCurrentPlacement: {
          upsert: vi.fn().mockResolvedValue({
            id: 'cur-res',
            manufacturingOrderBarcodeRaw: 'PN1',
            shelfCodeRaw: '西-北-01',
            clientDeviceId: 'dev-1',
            distributionNumber: 3,
            csvDashboardRowId: 'row-1',
            scheduleSnapshot: {
              ProductNo: 'PN1',
              FSEIBAN: 'FS1',
              FHINCD: 'HC1',
              FHINMEI: '品名'
            },
            updatedAt
          })
        }
      };
      return fn(tx);
    });

    const result = await applyHaizenScan({
      clientDeviceId: 'dev-1',
      manufacturingOrderBarcodeRaw: 'PN1',
      distributionNumber: 3
    });

    expect(result.resolutionStatus).toBe('RESOLVED');
    expect(result.current?.resolutionNote).toBe('RESOLVED');
    expect(result.current?.fseiban).toBe('FS1');
  });

  it('listHaizenCurrentPlacements は棚で絞り込む', async () => {
    const updatedAt = new Date('2025-05-03T12:00:00.000Z');
    vi.mocked(prisma.haizenCurrentPlacement.findMany).mockResolvedValue([
      {
        id: 'c1',
        manufacturingOrderBarcodeRaw: 'A',
        shelfCodeRaw: '西-北-01',
        clientDeviceId: 'dev-1',
        distributionNumber: null,
        csvDashboardRowId: null,
        scheduleSnapshot: Prisma.JsonNull,
        updatedAt
      }
    ] as never);

    const { rows } = await listHaizenCurrentPlacements({ shelfCodeRaw: '西-北-01', limit: 10 });
    expect(rows).toHaveLength(1);
    expect(prisma.haizenCurrentPlacement.findMany).toHaveBeenCalledWith({
      where: { shelfCodeRaw: '西-北-01' },
      orderBy: { updatedAt: 'desc' },
      take: 10
    });
  });
});
