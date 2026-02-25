import type { DataSource } from '../data-source.interface.js';
import type { TableVisualizationData, VisualizationData } from '../../visualization.types.js';
import { MachineService } from '../../../tools/machine.service.js';
import {
  clampPositiveInt,
  resolveJstDayRange,
  withDataSourceTiming,
} from '../_shared/data-source-utils.js';

const MAX_ROWS_LIMIT = 200;
const DEFAULT_MAX_ROWS = MAX_ROWS_LIMIT;
const SLOW_THRESHOLD_MS = 2000;

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

function buildEmptyTable(metadata: UninspectedMachinesMetadata): TableVisualizationData {
  return {
    kind: 'table',
    columns: ['設備管理番号', '加工機名称', '点検結果'],
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
    const date = typeof query.date === 'string' ? resolveJstDayRange(query.date).date : undefined;
    const maxRows = clampPositiveInt(query.maxRows, DEFAULT_MAX_ROWS, { max: MAX_ROWS_LIMIT });

    if (!csvDashboardId) {
      return buildEmptyTable({
        error: 'csvDashboardId is required',
      });
    }

    try {
      const result = await withDataSourceTiming(
        this.type,
        async () =>
          this.machineService.findDailyInspectionSummaries({
            csvDashboardId,
            date,
          }),
        { warnThresholdMs: SLOW_THRESHOLD_MS },
      );

      const sortedMachines = [...result.machines].sort((a, b) => {
        if (a.used !== b.used) {
          return a.used ? -1 : 1;
        }
        return a.equipmentManagementNumber.localeCompare(b.equipmentManagementNumber, 'ja', {
          numeric: true,
          sensitivity: 'base',
        });
      });

      const rows = sortedMachines.slice(0, maxRows).map((machine) => ({
        設備管理番号: machine.equipmentManagementNumber,
        加工機名称: machine.name,
        点検結果: machine.used ? `正常${machine.normalCount}/異常${machine.abnormalCount}` : '未使用',
      }));

      return {
        kind: 'table',
        columns: ['設備管理番号', '加工機名称', '点検結果'],
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

