import type { PrismaClient } from '@prisma/client';

import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
} from './constants.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

export type MachineNameCatalogEntry = {
  fseiban: string;
  machineName: string;
  source: 'production_schedule' | 'supplement';
};

export type MachineNameCatalogDataSource = {
  load(): Promise<MachineNameCatalogEntry[]>;
};

type MachineNameCatalogCache = {
  expiresAt: number;
  entries: MachineNameCatalogEntry[];
};

export class PrismaMachineNameCatalogDataSource implements MachineNameCatalogDataSource {
  constructor(private readonly client: Pick<PrismaClient, '$queryRaw' | 'productionScheduleSeibanMachineNameSupplement'> = prisma) {}

  async load(): Promise<MachineNameCatalogEntry[]> {
    type ScheduleRow = { fseiban: string | null; fhinmei: string | null };
    const [scheduleRows, supplementRows] = await Promise.all([
      this.client.$queryRaw<ScheduleRow[]>`
        SELECT
          ("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban",
          ("CsvDashboardRow"."rowData"->>'FHINMEI') AS "fhinmei"
        FROM "CsvDashboardRow"
        WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
          AND (
            UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) LIKE 'MH%'
            OR UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) LIKE 'SH%'
          )
          AND BTRIM(COALESCE("CsvDashboardRow"."rowData"->>'FSEIBAN', '')) <> ''
          AND BTRIM(COALESCE("CsvDashboardRow"."rowData"->>'FHINMEI', '')) <> ''
        GROUP BY
          ("CsvDashboardRow"."rowData"->>'FSEIBAN'),
          ("CsvDashboardRow"."rowData"->>'FHINMEI')
      `,
      this.client.productionScheduleSeibanMachineNameSupplement.findMany({
        where: {
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
        },
        select: {
          fseiban: true,
          machineName: true,
        },
      }),
    ]);

    const entries: MachineNameCatalogEntry[] = [];
    for (const row of scheduleRows) {
      const fseiban = row.fseiban?.trim() ?? '';
      const machineName = row.fhinmei?.trim() ?? '';
      if (fseiban && machineName) {
        entries.push({ fseiban, machineName, source: 'production_schedule' });
      }
    }
    for (const row of supplementRows) {
      const fseiban = row.fseiban.trim();
      const machineName = row.machineName.trim();
      if (fseiban && machineName) {
        entries.push({ fseiban, machineName, source: 'supplement' });
      }
    }
    return entries;
  }
}

export class MachineNameCatalogRepository {
  private cache: MachineNameCatalogCache | null = null;
  private loading: Promise<MachineNameCatalogEntry[]> | null = null;
  private generation = 0;

  constructor(
    private readonly dataSource: MachineNameCatalogDataSource = new PrismaMachineNameCatalogDataSource(),
    private readonly resolveTtlMs: () => number = () => env.PRODUCTION_SCHEDULE_MACHINE_NAME_FSEIBAN_CACHE_TTL_MS
  ) {}

  async list(): Promise<MachineNameCatalogEntry[]> {
    const ttlMs = this.resolveTtlMs();
    if (ttlMs > 0 && this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.entries;
    }
    if (this.loading) return this.loading;

    const loadGeneration = this.generation;
    const loading = this.dataSource.load();
    this.loading = loading;
    try {
      const entries = await loading;
      if (loadGeneration === this.generation) {
        this.cache = ttlMs > 0 ? { entries, expiresAt: Date.now() + ttlMs } : null;
      }
      return entries;
    } finally {
      if (this.loading === loading) this.loading = null;
    }
  }

  invalidate(): void {
    this.generation += 1;
    this.cache = null;
    this.loading = null;
  }
}

export const machineNameCatalogRepository = new MachineNameCatalogRepository();
