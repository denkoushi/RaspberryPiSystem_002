import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MachineService } from '../machine.service.js';
import { prisma } from '../../../lib/prisma.js';
import { ApiError } from '../../../lib/errors.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    machine: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    csvDashboardRow: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe('MachineService', () => {
  let service: MachineService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MachineService();
    vi.mocked(prisma.csvDashboardRow.deleteMany).mockResolvedValue({ count: 0 } as any);
  });

  it('稼働中マスター - 当日点検済みの差分で未点検を返す', async () => {
    const machines = [
      {
        id: 'm1',
        equipmentManagementNumber: '30024',
        name: 'HS3A_10P',
        shortName: null,
        classification: 'マシニングセンター',
        operatingStatus: '稼働中',
        ncManual: null,
        maker: '日立',
        processClassification: '切削',
        coolant: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'm2',
        equipmentManagementNumber: '30026',
        name: 'HS3A_6P',
        shortName: null,
        classification: 'マシニングセンター',
        operatingStatus: '稼働中',
        ncManual: null,
        maker: '日立',
        processClassification: '切削',
        coolant: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(prisma.machine.findMany).mockResolvedValue(machines as any);
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([
      {
        id: 'r1',
        occurredAt: new Date('2026-02-11T12:00:00Z'),
        rowData: { equipmentManagementNumber: '30024', inspectionAt: '2026-02-11T12:00:00Z', inspectionItem: '主軸' },
      },
      {
        id: 'r2',
        occurredAt: new Date('2026-02-11T12:01:00Z'),
        rowData: { equipmentManagementNumber: '99999', inspectionAt: '2026-02-11T12:01:00Z', inspectionItem: '主軸' },
      }, // マスター外は差分計算に影響しない
    ] as any);

    const result = await service.findUninspected({
      csvDashboardId: '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01',
      date: '2026-02-11',
    });

    expect(result.totalRunningMachines).toBe(2);
    expect(result.inspectedRunningCount).toBe(1);
    expect(result.uninspectedCount).toBe(1);
    expect(result.uninspectedMachines.map((m) => m.equipmentManagementNumber)).toEqual(['30026']);
  });

  it('稼働中加工機を設備単位で集約し点検結果件数と未使用を返す', async () => {
    const machines = [
      {
        id: 'm1',
        equipmentManagementNumber: '30024',
        name: 'HS3A_10P',
        shortName: null,
        classification: 'マシニングセンター',
        operatingStatus: '稼働中',
        ncManual: null,
        maker: '日立',
        processClassification: '切削',
        coolant: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'm2',
        equipmentManagementNumber: '30026',
        name: 'HS3A_6P',
        shortName: null,
        classification: 'マシニングセンター',
        operatingStatus: '稼働中',
        ncManual: null,
        maker: '日立',
        processClassification: '切削',
        coolant: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(prisma.machine.findMany).mockResolvedValue(machines as any);
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([
      {
        id: 'r1',
        occurredAt: new Date('2026-02-11T12:00:00Z'),
        rowData: {
          equipmentManagementNumber: '30024',
          inspectionItem: '主軸',
          inspectionAt: '2026-02-11T12:00:00Z',
          inspectionResult: '正常',
        },
      },
      {
        id: 'r2',
        occurredAt: new Date('2026-02-11T12:02:00Z'),
        rowData: {
          equipmentManagementNumber: '30024',
          inspectionItem: '主軸',
          inspectionAt: '2026-02-11T12:02:00Z',
          inspectionResult: '異常',
        },
      },
      {
        id: 'r3',
        occurredAt: new Date('2026-02-11T12:05:00Z'),
        rowData: {
          equipmentManagementNumber: '30024',
          inspectionItem: 'クーラント',
          inspectionAt: '2026-02-11T12:05:00Z',
          inspectionResult: '正常',
        },
      },
      {
        id: 'r4',
        occurredAt: new Date('2026-02-11T12:03:00Z'),
        rowData: {
          equipmentManagementNumber: '99999',
          inspectionItem: '主軸',
          inspectionAt: '2026-02-11T12:03:00Z',
          inspectionResult: '正常',
        },
      }, // マスター外は無視
    ] as any);

    const result = await service.findDailyInspectionSummaries({
      csvDashboardId: '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01',
      date: '2026-02-11',
    });

    expect(result.totalRunningMachines).toBe(2);
    expect(result.inspectedRunningCount).toBe(1);
    expect(result.uninspectedCount).toBe(1);
    expect(result.machines).toEqual([
      expect.objectContaining({
        equipmentManagementNumber: '30024',
        normalCount: 1,
        abnormalCount: 1,
        used: true,
      }),
      expect.objectContaining({
        equipmentManagementNumber: '30026',
        normalCount: 0,
        abnormalCount: 0,
        used: false,
      }),
    ]);
    expect(prisma.csvDashboardRow.deleteMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['r1'],
        },
      },
    });
  });

  it('findAll は search と operatingStatus の複合条件を組み立てる', async () => {
    vi.mocked(prisma.machine.findMany).mockResolvedValue([] as any);

    await service.findAll({ search: 'HS3A', operatingStatus: '稼働中' });

    expect(prisma.machine.findMany).toHaveBeenCalledWith({
      where: {
        operatingStatus: '稼働中',
        OR: [
          { name: { contains: 'HS3A', mode: 'insensitive' } },
          { shortName: { contains: 'HS3A', mode: 'insensitive' } },
          { equipmentManagementNumber: { contains: 'HS3A', mode: 'insensitive' } },
          { classification: { contains: 'HS3A', mode: 'insensitive' } },
          { maker: { contains: 'HS3A', mode: 'insensitive' } },
        ],
      },
      orderBy: [{ classification: 'asc' }, { equipmentManagementNumber: 'asc' }],
    });
  });

  it('create は設備管理番号が重複すると409を返す', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1' } as any);

    await expect(
      service.create({
        equipmentManagementNumber: '30024',
        name: 'HS3A_10P',
      }),
    ).rejects.toMatchObject<ApiError>({ statusCode: 409 });
  });

  it('update は対象がなければ404を返す', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);

    await expect(service.update('missing-machine', { name: 'new' })).rejects.toMatchObject<ApiError>({
      statusCode: 404,
    });
  });

  it('delete は対象がなければ404を返す', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);

    await expect(service.delete('missing-machine')).rejects.toMatchObject<ApiError>({
      statusCode: 404,
    });
  });

  it('findDailyInspectionSummaries は不正な日付形式で400を返す', async () => {
    await expect(
      service.findDailyInspectionSummaries({
        csvDashboardId: 'dashboard-1',
        date: '2026/02/11',
      }),
    ).rejects.toMatchObject<ApiError>({
      statusCode: 400,
      message: 'dateはYYYY-MM-DD形式で指定してください',
    });
  });
});
