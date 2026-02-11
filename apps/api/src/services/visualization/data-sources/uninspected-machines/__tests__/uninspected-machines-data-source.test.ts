import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UninspectedMachinesDataSource } from '../uninspected-machines-data-source.js';

const findUninspectedMock = vi.fn();

vi.mock('../../../../tools/machine.service.js', () => ({
  MachineService: class {
    findUninspected = findUninspectedMock;
  },
}));

describe('UninspectedMachinesDataSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error metadata when csvDashboardId is missing', async () => {
    const source = new UninspectedMachinesDataSource();
    const result = await source.fetchData({});

    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows).toHaveLength(0);
      expect(result.metadata?.error).toBe('csvDashboardId is required');
    }
    expect(findUninspectedMock).not.toHaveBeenCalled();
  });

  it('maps uninspected machines to table rows', async () => {
    findUninspectedMock.mockResolvedValue({
      date: '2026-02-11',
      csvDashboardId: '11111111-1111-1111-1111-111111111111',
      totalRunningMachines: 10,
      inspectedRunningCount: 7,
      uninspectedCount: 3,
      uninspectedMachines: [
        {
          equipmentManagementNumber: 'M-001',
          name: '加工機A',
          shortName: 'A',
          classification: 'MC',
          maker: 'MakerA',
          processClassification: '切削',
        },
      ],
    });

    const source = new UninspectedMachinesDataSource();
    const result = await source.fetchData({
      csvDashboardId: '11111111-1111-1111-1111-111111111111',
      maxRows: 10,
    });

    expect(findUninspectedMock).toHaveBeenCalledWith({
      csvDashboardId: '11111111-1111-1111-1111-111111111111',
      date: undefined,
    });
    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows).toEqual([
        {
          設備管理番号: 'M-001',
          加工機名称: '加工機A',
          略称: 'A',
          分類: 'MC',
          メーカー: 'MakerA',
          工程: '切削',
        },
      ]);
      expect(result.metadata?.uninspectedCount).toBe(3);
    }
  });

  it('limits rows by maxRows', async () => {
    findUninspectedMock.mockResolvedValue({
      date: '2026-02-11',
      csvDashboardId: '11111111-1111-1111-1111-111111111111',
      totalRunningMachines: 3,
      inspectedRunningCount: 0,
      uninspectedCount: 3,
      uninspectedMachines: [
        { equipmentManagementNumber: 'M-001', name: 'A', shortName: null, classification: null, maker: null, processClassification: null },
        { equipmentManagementNumber: 'M-002', name: 'B', shortName: null, classification: null, maker: null, processClassification: null },
        { equipmentManagementNumber: 'M-003', name: 'C', shortName: null, classification: null, maker: null, processClassification: null },
      ],
    });

    const source = new UninspectedMachinesDataSource();
    const result = await source.fetchData({
      csvDashboardId: '11111111-1111-1111-1111-111111111111',
      maxRows: 2,
    });

    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows).toHaveLength(2);
    }
  });
});

