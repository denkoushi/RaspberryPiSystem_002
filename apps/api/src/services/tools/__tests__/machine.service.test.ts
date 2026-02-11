import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MachineService } from '../machine.service.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    machine: {
      findMany: vi.fn(),
    },
    csvDashboardRow: {
      findMany: vi.fn(),
    },
  },
}));

describe('MachineService', () => {
  let service: MachineService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MachineService();
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
      { rowData: { equipmentManagementNumber: '30024' } },
      { rowData: { equipmentManagementNumber: '99999' } }, // マスター外は差分計算に影響しない
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
      { rowData: { equipmentManagementNumber: '30024', inspectionResult: '正常' } },
      { rowData: { equipmentManagementNumber: '30024', inspectionResult: '異常' } },
      { rowData: { equipmentManagementNumber: '30024', inspectionResult: '正常' } },
      { rowData: { equipmentManagementNumber: '99999', inspectionResult: '正常' } }, // マスター外は無視
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
        normalCount: 2,
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
  });
});
