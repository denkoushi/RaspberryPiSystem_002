import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UninspectedMachinesDataSource } from '../uninspected-machines-data-source.js';

const findDailyInspectionSummariesMock = vi.fn();

vi.mock('../../../../tools/machine.service.js', () => ({
  MachineService: class {
    findDailyInspectionSummaries = findDailyInspectionSummariesMock;
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
    expect(findDailyInspectionSummariesMock).not.toHaveBeenCalled();
  });

  it('maps daily machine summaries to table rows', async () => {
    findDailyInspectionSummariesMock.mockResolvedValue({
      date: '2026-02-11',
      csvDashboardId: '11111111-1111-1111-1111-111111111111',
      totalRunningMachines: 10,
      inspectedRunningCount: 7,
      uninspectedCount: 3,
      machines: [
        {
          equipmentManagementNumber: 'M-001',
          name: '加工機A',
          classification: 'MC',
          normalCount: 12,
          abnormalCount: 0,
          used: true,
        },
      ],
    });

    const source = new UninspectedMachinesDataSource();
    const result = await source.fetchData({
      csvDashboardId: '11111111-1111-1111-1111-111111111111',
      maxRows: 10,
    });

    expect(findDailyInspectionSummariesMock).toHaveBeenCalledWith({
      csvDashboardId: '11111111-1111-1111-1111-111111111111',
      date: undefined,
    });
    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows).toEqual([
        {
          設備管理番号: 'M-001',
          加工機名称: '加工機A',
          点検結果: '正常12/異常0',
        },
      ]);
      expect(result.metadata?.uninspectedCount).toBe(3);
    }
  });

  it('limits rows by maxRows', async () => {
    findDailyInspectionSummariesMock.mockResolvedValue({
      date: '2026-02-11',
      csvDashboardId: '11111111-1111-1111-1111-111111111111',
      totalRunningMachines: 3,
      inspectedRunningCount: 0,
      uninspectedCount: 3,
      machines: [
        { equipmentManagementNumber: 'M-001', name: 'A', shortName: null, classification: null, maker: null, processClassification: null, normalCount: 0, abnormalCount: 0, used: false },
        { equipmentManagementNumber: 'M-002', name: 'B', shortName: null, classification: null, maker: null, processClassification: null, normalCount: 0, abnormalCount: 0, used: false },
        { equipmentManagementNumber: 'M-003', name: 'C', shortName: null, classification: null, maker: null, processClassification: null, normalCount: 0, abnormalCount: 0, used: false },
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

  it('shows 未使用 for machines with no daily records', async () => {
    findDailyInspectionSummariesMock.mockResolvedValue({
      date: '2026-02-11',
      csvDashboardId: '11111111-1111-1111-1111-111111111111',
      totalRunningMachines: 1,
      inspectedRunningCount: 0,
      uninspectedCount: 1,
      machines: [
        {
          equipmentManagementNumber: 'M-010',
          name: '加工機X',
          shortName: null,
          classification: 'MC',
          maker: null,
          processClassification: null,
          normalCount: 0,
          abnormalCount: 0,
          used: false,
        },
      ],
    });

    const source = new UninspectedMachinesDataSource();
    const result = await source.fetchData({
      csvDashboardId: '11111111-1111-1111-1111-111111111111',
    });

    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows[0]).toEqual({
        設備管理番号: 'M-010',
        加工機名称: '加工機X',
        点検結果: '未使用',
      });
    }
  });

  it('sorts used machines first and places 未使用 at end', async () => {
    findDailyInspectionSummariesMock.mockResolvedValue({
      date: '2026-02-11',
      csvDashboardId: '11111111-1111-1111-1111-111111111111',
      totalRunningMachines: 3,
      inspectedRunningCount: 2,
      uninspectedCount: 1,
      machines: [
        { equipmentManagementNumber: 'M-003', name: 'C', shortName: null, classification: null, maker: null, processClassification: null, normalCount: 0, abnormalCount: 0, used: false },
        { equipmentManagementNumber: 'M-002', name: 'B', shortName: null, classification: null, maker: null, processClassification: null, normalCount: 2, abnormalCount: 0, used: true },
        { equipmentManagementNumber: 'M-001', name: 'A', shortName: null, classification: null, maker: null, processClassification: null, normalCount: 1, abnormalCount: 0, used: true },
      ],
    });

    const source = new UninspectedMachinesDataSource();
    const result = await source.fetchData({
      csvDashboardId: '11111111-1111-1111-1111-111111111111',
      maxRows: 10,
    });

    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows.map((row) => row['設備管理番号'])).toEqual(['M-001', 'M-002', 'M-003']);
      expect(result.rows[result.rows.length - 1]?.['点検結果']).toBe('未使用');
    }
  });
});

