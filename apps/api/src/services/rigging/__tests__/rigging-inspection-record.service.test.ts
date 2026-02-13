import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { RiggingInspectionRecordService } from '../rigging-inspection-record.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    riggingInspectionRecord: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    riggingGear: {
      findUnique: vi.fn(),
    },
    employee: {
      findUnique: vi.fn(),
    },
  },
}));

describe('RiggingInspectionRecordService', () => {
  let service: RiggingInspectionRecordService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RiggingInspectionRecordService();
  });

  it('findByRiggingGear は検索条件を where に渡す', async () => {
    vi.mocked(prisma.riggingInspectionRecord.findMany).mockResolvedValue([] as never);

    await service.findByRiggingGear('gear-1', {
      employeeId: 'emp-1',
      result: 'OK',
    });

    expect(prisma.riggingInspectionRecord.findMany).toHaveBeenCalledWith({
      where: {
        riggingGearId: 'gear-1',
        employeeId: 'emp-1',
        result: 'OK',
        inspectedAt: {
          gte: undefined,
          lte: undefined,
        },
      },
      orderBy: { inspectedAt: 'desc' },
    });
  });

  it('create は吊具が存在しない場合404を返す', async () => {
    vi.mocked(prisma.riggingGear.findUnique).mockResolvedValue(null);

    await expect(
      service.create({
        riggingGearId: 'missing-gear',
        employeeId: 'emp-1',
        result: 'OK',
        inspectedAt: new Date('2026-02-12T00:00:00Z'),
      })
    ).rejects.toThrow(ApiError);

    await expect(
      service.create({
        riggingGearId: 'missing-gear',
        employeeId: 'emp-1',
        result: 'OK',
        inspectedAt: new Date('2026-02-12T00:00:00Z'),
      })
    ).rejects.toThrow('吊具が見つかりません');
  });

  it('create は従業員が存在しない場合404を返す', async () => {
    vi.mocked(prisma.riggingGear.findUnique).mockResolvedValue({ id: 'gear-1' } as never);
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null);

    await expect(
      service.create({
        riggingGearId: 'gear-1',
        employeeId: 'missing-emp',
        result: 'NG',
        inspectedAt: new Date('2026-02-12T00:00:00Z'),
      })
    ).rejects.toThrow('従業員が見つかりません');
  });
});
