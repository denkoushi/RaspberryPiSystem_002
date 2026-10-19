import { Prisma, type PrismaClient } from '@prisma/client';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../production-schedule/seiban-machine-display-names.service.js';
import { buildMaxProductNoWinnerCondition } from '../production-schedule/row-resolver/index.js';
import type { ScawStfutekigoEnrichmentAdapter } from './enrichment.js';
import type { ScawStfutekigoEnrichment } from './types.js';

type ProductionCandidate = {
  orderKey: string | null;
  partNumber: string | null;
  partName: string | null;
  resolvedSeiban: string | null;
};

/** Exact manufacturing-order lookup against the retained production schedule rows. */
export class ProductionScheduleScawStfutekigoEnrichmentAdapter implements ScawStfutekigoEnrichmentAdapter {
  constructor(
    private readonly client: Pick<PrismaClient, '$queryRaw'>,
    private readonly resolveMachineNames: typeof resolveSeibanMachineDisplayNamesBatched = resolveSeibanMachineDisplayNamesBatched
  ) {}

  async enrich(orderNumbers: readonly string[]): Promise<ReadonlyMap<string, ScawStfutekigoEnrichment>> {
    const keys = [
      ...new Set(orderNumbers.map((value) => value.normalize('NFKC').trim().toUpperCase()).filter(Boolean)),
    ];
    const result = new Map<string, ScawStfutekigoEnrichment>();
    if (keys.length === 0) return result;

    const candidates = await this.client.$queryRaw<ProductionCandidate[]>`
      SELECT
        UPPER(BTRIM("r"."rowData"->>'ProductNo')) AS "orderKey",
        UPPER(BTRIM("r"."rowData"->>'FHINCD')) AS "partNumber",
        MIN(NULLIF(BTRIM("r"."rowData"->>'FHINMEI'), '')) AS "partName",
        MIN(NULLIF(BTRIM("r"."rowData"->>'FSEIBAN'), '')) AS "resolvedSeiban"
      FROM "CsvDashboardRow"
        AS "r"
      WHERE "r"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND (
          UPPER(BTRIM("r"."rowData"->>'ProductNo')) IN (${Prisma.join(keys)})
        )
        AND NULLIF(BTRIM("r"."rowData"->>'FHINCD'), '') IS NOT NULL
        AND UPPER(BTRIM("r"."rowData"->>'FHINCD')) NOT LIKE 'MH%'
        AND UPPER(BTRIM("r"."rowData"->>'FHINCD')) NOT LIKE 'SH%'
        AND ${buildMaxProductNoWinnerCondition('r')}
      GROUP BY UPPER(BTRIM("r"."rowData"->>'ProductNo')), UPPER(BTRIM("r"."rowData"->>'FHINCD'))
      ORDER BY "orderKey" ASC, "partNumber" ASC
    `;

    const byKey = new Map<string, ProductionCandidate[]>();
    for (const candidate of candidates) {
      const key = candidate.orderKey?.trim();
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push(candidate);
      byKey.set(key, list);
    }
    const resolvedSeibans = [
      ...new Set(keys.map((key) => byKey.get(key)?.[0]?.resolvedSeiban?.trim() ?? '').filter(Boolean)),
    ];
    const resolvedMachineNames =
      resolvedSeibans.length > 0 ? (await this.resolveMachineNames(resolvedSeibans)).machineNames : {};

    for (const key of keys) {
      const list = byKey.get(key) ?? [];
      if (list.length === 0) {
        result.set(key, {
          partNumber: null,
          partName: null,
          machineName: null,
          resolvedSeiban: null,
          enrichmentStatus: 'NOT_FOUND',
          enrichedAt: null,
        });
        continue;
      }
      if (list.length > 1) {
        result.set(key, {
          partNumber: null,
          partName: null,
          machineName: null,
          resolvedSeiban: null,
          enrichmentStatus: 'AMBIGUOUS',
          enrichedAt: null,
        });
        continue;
      }
      const candidate = list[0];
      result.set(key, {
        partNumber: candidate.partNumber,
        partName: candidate.partName,
        machineName: candidate.resolvedSeiban ? (resolvedMachineNames[candidate.resolvedSeiban] ?? null) : null,
        resolvedSeiban: candidate.resolvedSeiban,
        enrichmentStatus: 'RESOLVED',
        enrichedAt: new Date(),
      });
    }
    return result;
  }
}
