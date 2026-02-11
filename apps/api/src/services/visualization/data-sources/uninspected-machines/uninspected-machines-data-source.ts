import type { DataSource } from '../data-source.interface.js';
import type { TableVisualizationData, VisualizationData } from '../../visualization.types.js';
import { MachineService } from '../../../tools/machine.service.js';

const DEFAULT_MAX_ROWS = 30;
const MAX_ROWS_LIMIT = 200;

type UninspectedMachinesMetadata = {
  date?: string;
  csvDashboardId?: string;
  totalRunningMachines?: number;
  inspectedRunningCount?: number;
  uninspectedCount?: number;
  error?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(MAX_ROWS_LIMIT, Math.floor(value)));
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.min(MAX_ROWS_LIMIT, Math.floor(parsed)));
    }
  }
  return fallback;
}

function buildEmptyTable(metadata: UninspectedMachinesMetadata): TableVisualizationData {
  return {
    kind: 'table',
    columns: ['設備管理番号', '加工機名称', '分類', '点検結果'],
    rows: [],
    metadata,
  };
}

export class UninspectedMachinesDataSource implements DataSource {
  readonly type = 'uninspected_machines';
  private readonly machineService = new MachineService();

  async fetchData(config: Record<string, unknown>): Promise<VisualizationData> {
    const query = asRecord(config);
    const csvDashboardId = typeof query.csvDashboardId === 'string' ? query.csvDashboardId : '';
    const date = typeof query.date === 'string' ? query.date : undefined;
    const maxRows = parsePositiveInt(query.maxRows, DEFAULT_MAX_ROWS);

    if (!csvDashboardId) {
      return buildEmptyTable({
        error: 'csvDashboardId is required',
      });
    }

    try {
      const result = await this.machineService.findDailyInspectionSummaries({
        csvDashboardId,
        date,
      });

      const rows = result.machines.slice(0, maxRows).map((machine) => ({
        設備管理番号: machine.equipmentManagementNumber,
        加工機名称: machine.name,
        分類: machine.classification ?? '',
        点検結果: machine.used ? `正常${machine.normalCount}/異常${machine.abnormalCount}` : '未使用',
      }));

      return {
        kind: 'table',
        columns: ['設備管理番号', '加工機名称', '分類', '点検結果'],
        rows,
        metadata: {
          date: result.date,
          csvDashboardId: result.csvDashboardId,
          totalRunningMachines: result.totalRunningMachines,
          inspectedRunningCount: result.inspectedRunningCount,
          uninspectedCount: result.uninspectedCount,
        } satisfies UninspectedMachinesMetadata,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to resolve uninspected machines';
      return buildEmptyTable({
        csvDashboardId,
        error: message,
      });
    }
  }
}

