import { prisma } from '../../../../lib/prisma.js';
import { normalizeMachineNameForSignage } from '../../../signage/kiosk-progress-overview/progress-overview-signage-format.js';
import type { TableVisualizationData } from '../../visualization.types.js';
import type { DataSource } from '../data-source.interface.js';
import { clampPositiveInt } from '../_shared/data-source-utils.js';
import { exchangeDates, jstDate, normalizeCycle, type ExchangeState } from './cycle-date.js';
import { isRobodrill } from './is-robodrill.js';

const COLUMNS = ['equipmentManagementNumber', 'machineName', 'subText', 'cycle', 'lastDate', 'nextDate', 'remainingDays', 'state'];
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_KEYS = 20;
type SourceRow = {
  equipmentManagementNumber: string;
  machineName: string | null;
  cycle: string | null;
  occurredAt: Date;
  masterName: string | null;
  classification: string | null;
  maker: string | null;
};
type Counts = Record<ExchangeState, number>;
type CachedResult = { expiresAt: number; today: string; rows: TableVisualizationData['rows']; counts: Counts };

export class HydraulicOilExchangeDataSource implements DataSource {
  readonly type = 'hydraulic_oil_exchange';
  private readonly cache = new Map<string, CachedResult>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  resetCache(): void {
    this.cache.clear();
  }

  async fetchData(config: Record<string, unknown>): Promise<TableVisualizationData> {
    const today = jstDate(this.now());
    const csvDashboardId = typeof config.csvDashboardId === 'string' ? config.csvDashboardId : '';
    const inspectionItem = typeof config.inspectionItem === 'string' ? config.inspectionItem.trim() : '作動油の交換';
    const targetEquipmentNumbers = [...new Set(
      (Array.isArray(config.targetEquipmentNumbers) ? config.targetEquipmentNumbers : [])
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim()).filter(Boolean),
    )].sort();
    const maxRows = clampPositiveInt(config.maxRows, 200, { max: 200 });
    const empty = (error: string): TableVisualizationData => ({
      kind: 'table', columns: COLUMNS, rows: [],
      metadata: { today, counts: { overdue: 0, soon: 0, ok: 0, unknown: 0, none: 0 }, error },
    });
    if (!csvDashboardId) return empty('csvDashboardId is required');

    try {
      const key = JSON.stringify([csvDashboardId, inspectionItem, targetEquipmentNumbers]);
      let result = this.cache.get(key);
      if (!result || result.expiresAt <= this.now().getTime() || result.today !== today) {
        const records = await prisma.$queryRaw<SourceRow[]>`
          SELECT latest.*, m.name AS "masterName", m.classification, m.maker
          FROM (
            SELECT DISTINCT ON (btrim("rowData"->>'equipmentManagementNumber'))
              btrim("rowData"->>'equipmentManagementNumber') AS "equipmentManagementNumber",
              "rowData"->>'machineName' AS "machineName",
              "rowData"->>'cycle' AS cycle, "occurredAt"
            FROM "CsvDashboardRow"
            WHERE "csvDashboardId" = ${csvDashboardId}
              AND "occurredAt" >= now() - interval '25 months'
              AND btrim("rowData"->>'inspectionItem', E' \\t\\n\\r\u3000') = ${inspectionItem}
              AND NULLIF(btrim("rowData"->>'equipmentManagementNumber'), '') IS NOT NULL
            ORDER BY btrim("rowData"->>'equipmentManagementNumber'), "occurredAt" DESC, "createdAt" DESC, id DESC
          ) latest
          LEFT JOIN "Machine" m ON m."equipmentManagementNumber" = latest."equipmentManagementNumber"
        `;
        const selectedMachines = targetEquipmentNumbers.length ? await prisma.machine.findMany({
          where: { equipmentManagementNumber: { in: targetEquipmentNumbers } },
          select: { equipmentManagementNumber: true, name: true, classification: true, maker: true },
        }) : [];
        const excludedNumbers = new Set([
          ...records.filter((row) => isRobodrill(row.masterName, row.machineName)).map((row) => row.equipmentManagementNumber),
          ...selectedMachines.filter((machine) => isRobodrill(machine.name)).map((machine) => machine.equipmentManagementNumber),
        ]);
        const recordNumbers = new Set(records.map((row) => row.equipmentManagementNumber));
        const recordedRows = records.filter((row) => !excludedNumbers.has(row.equipmentManagementNumber)).map((row) => {
          const dates = exchangeDates(row.occurredAt, row.cycle, new Date(`${today}T00:00:00+09:00`));
          return {
            equipmentManagementNumber: row.equipmentManagementNumber,
            machineName: normalizeMachineNameForSignage(row.masterName?.trim() || row.machineName),
            subText: row.classification?.trim() || row.maker?.trim() || '',
            cycle: normalizeCycle(row.cycle),
            ...dates,
          };
        });
        const selectedByNumber = new Map(selectedMachines.map((machine) => [machine.equipmentManagementNumber, machine]));
        const unrecordedRows = targetEquipmentNumbers
          .filter((number) => !excludedNumbers.has(number) && !recordNumbers.has(number))
          .map((number) => {
            const machine = selectedByNumber.get(number);
            return {
              equipmentManagementNumber: number,
              machineName: normalizeMachineNameForSignage(machine?.name.trim() || number),
              subText: machine?.classification?.trim() || machine?.maker?.trim() || '',
              cycle: null, lastDate: null, nextDate: null, remainingDays: null, state: 'none' as const,
            };
          });
        const rows = [...recordedRows, ...unrecordedRows].sort((a, b) => {
          if (a.remainingDays !== b.remainingDays) {
            if (a.remainingDays === null) return 1;
            if (b.remainingDays === null) return -1;
            return a.remainingDays - b.remainingDays;
          }
          if (a.state !== b.state) return a.state === 'none' ? 1 : -1;
          return a.equipmentManagementNumber.localeCompare(b.equipmentManagementNumber, 'ja', { numeric: true });
        });
        const counts: Counts = { overdue: 0, soon: 0, ok: 0, unknown: 0, none: 0 };
        for (const row of rows) counts[row.state]++;
        // Retain only displayable rows; counts cover all matching machines, regardless of maxRows.
        result = { rows: rows.slice(0, 200), counts, today, expiresAt: this.now().getTime() + CACHE_TTL_MS };
        this.cache.delete(key);
        if (this.cache.size >= CACHE_MAX_KEYS) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, result);
      }
      return {
        kind: 'table', columns: COLUMNS, rows: result.rows.slice(0, maxRows).map((row) => ({ ...row })),
        metadata: { today, counts: { ...result.counts } },
      };
    } catch (error) {
      return empty(error instanceof Error ? error.message : 'failed to resolve hydraulic oil exchanges');
    }
  }
}
