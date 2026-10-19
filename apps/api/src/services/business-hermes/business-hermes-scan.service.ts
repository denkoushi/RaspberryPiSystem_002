import { Prisma, type PrismaClient } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { buildMaxProductNoWinnerCondition } from '../production-schedule/row-resolver/index.js';
import { ScawStFutekigoReadService } from '../scaw-stfutekigo/scaw-stfutekigo-read.service.js';
import { getWorkInstructionServices } from '../work-instructions/work-instruction-service.factory.js';
import type { WorkInstructionReadService } from '../work-instructions/work-instruction-read.service.js';

export type BusinessHermesScanMatchKind = 'manufacturing_order' | 'part_number' | 'other';

export type BusinessHermesScanMatch = {
  kind: BusinessHermesScanMatchKind;
  source: 'production_schedule' | 'nonconformity' | 'work_instruction';
  matchField: 'ProductNo' | 'FSEIBAN' | 'FHINCD' | 'ScawStFutekigoCurrent.partNumber' | 'WorkInstruction.partNumber' | 'WorkInstructionPartAlias.canonicalPartNumber';
  matchedValue: string;
  productNo?: string;
  partNumber?: string;
  serialNumber?: string;
  partName?: string;
};

export type BusinessHermesScanResolution = {
  rawValue: string;
  kind: BusinessHermesScanMatchKind | 'unknown';
  ambiguous: boolean;
  candidateCount: number;
  truncated: boolean;
  matches: ReadonlyArray<BusinessHermesScanMatch>;
};

type ScheduleScanRow = {
  productNo: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  fsigencd: string;
  fkojun: number | null;
};

type ScanResolverDeps = {
  db?: PrismaClient;
  scheduleByProductNo?: (value: string) => Promise<ReadonlyArray<ScheduleScanRow>>;
  scheduleByFseiban?: (value: string) => Promise<ReadonlyArray<ScheduleScanRow>>;
  nonconformities?: Pick<ScawStFutekigoReadService, 'readCurrentByPartNumber'>;
  workInstructions?: Pick<WorkInstructionReadService, 'readPublishedGroups' | 'readPublishedPartAlias'>;
  scheduleByPartNumber?: (value: string) => Promise<ReadonlyArray<ScheduleScanRow>>;
};

function normalizeScan(value: string): string {
  return value.trim();
}

function matchKey(match: BusinessHermesScanMatch): string {
  return [
    match.kind,
    match.source,
    match.matchField,
    match.matchedValue,
    match.productNo ?? '',
    match.partNumber ?? '',
    match.serialNumber ?? '',
    match.partName ?? ''
  ].join(':');
}

function candidateKey(match: BusinessHermesScanMatch): string {
  const candidate = match.kind === 'manufacturing_order'
    ? match.productNo ?? match.matchedValue
    : match.kind === 'part_number'
      ? match.partNumber ?? match.matchedValue
      : match.serialNumber ?? match.matchedValue;
  return `${match.kind}:${candidate}`;
}

function uniqueMatches(matches: ReadonlyArray<BusinessHermesScanMatch>): BusinessHermesScanMatch[] {
  const grouped = new Map<string, BusinessHermesScanMatch>();
  for (const match of matches) {
    const key = matchKey(match);
    if (!grouped.has(key)) grouped.set(key, match);
  }
  return [...grouped.values()];
}

function boundedMatches(matches: ReadonlyArray<BusinessHermesScanMatch>, limit = 12): BusinessHermesScanMatch[] {
  if (matches.length <= limit) return [...matches];
  const selected: BusinessHermesScanMatch[] = [];
  const selectedKeys = new Set<string>();
  const selectedCandidates = new Set<string>();
  for (const match of matches) {
    const candidate = candidateKey(match);
    if (selectedCandidates.has(candidate)) continue;
    selected.push(match);
    selectedKeys.add(matchKey(match));
    selectedCandidates.add(candidate);
    if (selected.length >= limit) return selected;
  }
  for (const match of matches) {
    if (selectedKeys.has(matchKey(match))) continue;
    selected.push(match);
    if (selected.length >= limit) return selected;
  }
  return selected;
}

function resolution(rawValue: string, matches: ReadonlyArray<BusinessHermesScanMatch>): BusinessHermesScanResolution {
  const unique = uniqueMatches(matches);
  const kinds = new Set(unique.map((match) => match.kind));
  const candidates = new Set(unique.map(candidateKey));
  const kind = kinds.size === 1 ? [...kinds][0] : 'unknown';
  return {
    rawValue,
    kind,
    ambiguous: candidates.size > 1,
    candidateCount: candidates.size,
    truncated: unique.length > 12,
    matches: boundedMatches(unique)
  };
}

export class BusinessHermesScanResolver {
  private readonly db: PrismaClient;
  private readonly scheduleByProductNo: (value: string) => Promise<ReadonlyArray<ScheduleScanRow>>;
  private readonly scheduleByFseiban: (value: string) => Promise<ReadonlyArray<ScheduleScanRow>>;
  private readonly nonconformities: Pick<ScawStFutekigoReadService, 'readCurrentByPartNumber'>;
  private readonly workInstructions: Pick<WorkInstructionReadService, 'readPublishedGroups' | 'readPublishedPartAlias'>;
  private readonly scheduleByPartNumber: (value: string) => Promise<ReadonlyArray<ScheduleScanRow>>;

  constructor(deps: ScanResolverDeps = {}) {
    this.db = deps.db ?? prisma;
    this.scheduleByProductNo = deps.scheduleByProductNo ?? ((value) => this.readScheduleRows('ProductNo', value));
    this.scheduleByFseiban = deps.scheduleByFseiban ?? ((value) => this.readScheduleRows('FSEIBAN', value));
    this.scheduleByPartNumber = deps.scheduleByPartNumber ?? ((value) => this.readScheduleRows('FHINCD', value));
    this.nonconformities = deps.nonconformities ?? new ScawStFutekigoReadService();
    this.workInstructions = deps.workInstructions ?? getWorkInstructionServices().read;
  }

  async resolve(value: string): Promise<BusinessHermesScanResolution> {
    const rawValue = normalizeScan(value);
    if (!rawValue) return resolution('', []);

    if (rawValue.length > 500) throw new Error('scan value is too long');
    const [productRows, serialRows, partRows, nonconformities, directGroups, alias] = await Promise.all([
      this.scheduleByProductNo(rawValue),
      this.scheduleByFseiban(rawValue),
      this.scheduleByPartNumber(rawValue),
      this.nonconformities.readCurrentByPartNumber(rawValue),
      this.workInstructions.readPublishedGroups({ partNumber: rawValue, limit: 5, offset: 0 }),
      this.workInstructions.readPublishedPartAlias(rawValue)
    ]);
    const matches: BusinessHermesScanMatch[] = [];

    for (const row of productRows) {
      matches.push({
        kind: 'manufacturing_order',
        source: 'production_schedule',
        matchField: 'ProductNo',
        matchedValue: row.productNo,
        productNo: row.productNo,
        ...(row.fseiban ? { serialNumber: row.fseiban } : {}),
        ...(row.fhincd ? { partNumber: row.fhincd } : {}),
        ...(row.fhinmei ? { partName: row.fhinmei } : {})
      });
    }
    for (const row of serialRows) {
      matches.push({
        kind: 'other',
        source: 'production_schedule',
        matchField: 'FSEIBAN',
        matchedValue: row.fseiban,
        ...(row.productNo ? { productNo: row.productNo } : {}),
        serialNumber: row.fseiban,
        ...(row.fhincd ? { partNumber: row.fhincd } : {}),
        ...(row.fhinmei ? { partName: row.fhinmei } : {})
      });
    }
    for (const row of partRows) {
      matches.push({
        kind: 'part_number',
        source: 'production_schedule',
        matchField: 'FHINCD',
        matchedValue: row.fhincd,
        partNumber: row.fhincd,
        ...(row.productNo ? { productNo: row.productNo } : {}),
        ...(row.fseiban ? { serialNumber: row.fseiban } : {}),
        ...(row.fhinmei ? { partName: row.fhinmei } : {})
      });
    }
    if (nonconformities.length > 0) {
      matches.push({
        kind: 'part_number',
        source: 'nonconformity',
        matchField: 'ScawStFutekigoCurrent.partNumber',
        matchedValue: rawValue,
        partNumber: rawValue,
        ...(nonconformities[0]?.partName ? { partName: nonconformities[0].partName } : {})
      });
    }
    if (directGroups.length > 0) {
      matches.push({
        kind: 'part_number',
        source: 'work_instruction',
        matchField: 'WorkInstruction.partNumber',
        matchedValue: rawValue,
        partNumber: rawValue
      });
    }
    if (alias) {
      matches.push({
        kind: 'part_number',
        source: 'work_instruction',
        matchField: 'WorkInstructionPartAlias.canonicalPartNumber',
        matchedValue: alias.canonicalPartNumber,
        partNumber: alias.canonicalPartNumber,
        ...(alias.partName ? { partName: alias.partName } : {})
      });
    }
    return resolution(rawValue, matches);
  }

  private async readScheduleRows(field: 'ProductNo' | 'FSEIBAN' | 'FHINCD', value: string): Promise<ReadonlyArray<ScheduleScanRow>> {
    const column = field;
    const columnSql = Prisma.raw(`'${column}'`);
    return this.db.$queryRaw<ScheduleScanRow[]>`
      SELECT
        TRIM(COALESCE("CsvDashboardRow"."rowData"->>'ProductNo', '')) AS "productNo",
        TRIM(COALESCE("CsvDashboardRow"."rowData"->>'FSEIBAN', '')) AS "fseiban",
        TRIM(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) AS "fhincd",
        TRIM(COALESCE("CsvDashboardRow"."rowData"->>'FHINMEI', '')) AS "fhinmei",
        TRIM(COALESCE("CsvDashboardRow"."rowData"->>'FSIGENCD', '')) AS "fsigencd",
        CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FKOJUN') ~ '^[0-9]+$'
          THEN (("CsvDashboardRow"."rowData"->>'FKOJUN'))::int
          ELSE NULL
        END AS "fkojun"
      FROM "CsvDashboardRow"
      WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
        AND TRIM("CsvDashboardRow"."rowData"->>${columnSql}) = ${value}
      ORDER BY "fkojun" ASC NULLS LAST, "fhincd" ASC
    `;
  }
}
