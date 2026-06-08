import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
} from './constants.js';
import { normalizeMachineNameForCompare } from './machine-name-compare.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

type ScheduleMachineNameEntry = {
  fseiban: string;
  fhinmei: string;
};

type SupplementMachineNameEntry = {
  fseiban: string;
  machineName: string;
};

type MachineNameIndexCache<T> = {
  expiresAt: number;
  entries: T[];
};

let scheduleMachineNameIndexCache: MachineNameIndexCache<ScheduleMachineNameEntry> | null = null;
let supplementMachineNameIndexCache: MachineNameIndexCache<SupplementMachineNameEntry> | null = null;
const matchingFseibansByMachineNameCache = new Map<
  string,
  { expiresAt: number; fseibans: string[] }
>();

function resolveCacheTtlMs(): number {
  return env.PRODUCTION_SCHEDULE_MACHINE_NAME_FSEIBAN_CACHE_TTL_MS;
}

function isCacheEntryValid(expiresAt: number, ttlMs: number): boolean {
  return ttlMs > 0 && expiresAt > Date.now();
}

function pruneExpiredMatchingFseibanCache(ttlMs: number, now = Date.now()): void {
  if (ttlMs <= 0) {
    matchingFseibansByMachineNameCache.clear();
    return;
  }

  for (const [machineName, entry] of matchingFseibansByMachineNameCache.entries()) {
    if (entry.expiresAt <= now) {
      matchingFseibansByMachineNameCache.delete(machineName);
    }
  }
}

async function loadScheduleMachineNameIndex(): Promise<ScheduleMachineNameEntry[]> {
  type MachineRow = { fseiban: string | null; fhinmei: string | null };
  const rows = await prisma.$queryRaw<MachineRow[]>`
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
  `;

  const entries: ScheduleMachineNameEntry[] = [];
  for (const row of rows) {
    const fseiban = row.fseiban?.trim() ?? '';
    const fhinmei = row.fhinmei?.trim() ?? '';
    if (fseiban.length === 0 || fhinmei.length === 0) {
      continue;
    }
    entries.push({ fseiban, fhinmei });
  }
  return entries;
}

async function loadSupplementMachineNameIndex(): Promise<SupplementMachineNameEntry[]> {
  const rows = await prisma.productionScheduleSeibanMachineNameSupplement.findMany({
    where: {
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
    },
    select: {
      fseiban: true,
      machineName: true,
    },
  });

  const entries: SupplementMachineNameEntry[] = [];
  for (const row of rows) {
    const fseiban = row.fseiban.trim();
    const machineName = row.machineName.trim();
    if (fseiban.length === 0 || machineName.length === 0) {
      continue;
    }
    entries.push({ fseiban, machineName });
  }
  return entries;
}

async function getScheduleMachineNameIndex(): Promise<ScheduleMachineNameEntry[]> {
  const ttlMs = resolveCacheTtlMs();
  if (
    scheduleMachineNameIndexCache &&
    isCacheEntryValid(scheduleMachineNameIndexCache.expiresAt, ttlMs)
  ) {
    return scheduleMachineNameIndexCache.entries;
  }

  const entries = await loadScheduleMachineNameIndex();
  if (ttlMs > 0) {
    scheduleMachineNameIndexCache = {
      entries,
      expiresAt: Date.now() + ttlMs,
    };
  } else {
    scheduleMachineNameIndexCache = null;
  }
  return entries;
}

async function getSupplementMachineNameIndex(): Promise<SupplementMachineNameEntry[]> {
  const ttlMs = resolveCacheTtlMs();
  if (
    supplementMachineNameIndexCache &&
    isCacheEntryValid(supplementMachineNameIndexCache.expiresAt, ttlMs)
  ) {
    return supplementMachineNameIndexCache.entries;
  }

  const entries = await loadSupplementMachineNameIndex();
  if (ttlMs > 0) {
    supplementMachineNameIndexCache = {
      entries,
      expiresAt: Date.now() + ttlMs,
    };
  } else {
    supplementMachineNameIndexCache = null;
  }
  return entries;
}

function resolveMatchingFseibansFromIndexes(
  normalizedMachineName: string,
  scheduleIndex: ScheduleMachineNameEntry[],
  supplementIndex: SupplementMachineNameEntry[]
): string[] {
  return Array.from(
    new Set([
      ...scheduleIndex
        .filter((row) => normalizeMachineNameForCompare(row.fhinmei) === normalizedMachineName)
        .map((row) => row.fseiban),
      ...supplementIndex
        .filter((row) => normalizeMachineNameForCompare(row.machineName) === normalizedMachineName)
        .map((row) => row.fseiban),
    ])
  );
}

/** 正規化済み機種名に一致する FSEIBAN 一覧（短 TTL インデックスキャッシュ付き） */
export async function resolveMatchingFseibansByNormalizedMachineName(
  normalizedMachineName: string
): Promise<string[]> {
  if (normalizedMachineName.length === 0) {
    return [];
  }

  const ttlMs = resolveCacheTtlMs();
  pruneExpiredMatchingFseibanCache(ttlMs);
  const cached = matchingFseibansByMachineNameCache.get(normalizedMachineName);
  if (cached && isCacheEntryValid(cached.expiresAt, ttlMs)) {
    return cached.fseibans;
  }

  const [scheduleIndex, supplementIndex] = await Promise.all([
    getScheduleMachineNameIndex(),
    getSupplementMachineNameIndex(),
  ]);
  const fseibans = resolveMatchingFseibansFromIndexes(
    normalizedMachineName,
    scheduleIndex,
    supplementIndex
  );

  if (ttlMs > 0) {
    matchingFseibansByMachineNameCache.set(normalizedMachineName, {
      fseibans,
      expiresAt: Date.now() + ttlMs,
    });
  } else {
    matchingFseibansByMachineNameCache.delete(normalizedMachineName);
  }

  return fseibans;
}

/** テスト/取り込み後のキャッシュ無効化 */
export function resetMachineNameFseibanMatchCaches(): void {
  scheduleMachineNameIndexCache = null;
  supplementMachineNameIndexCache = null;
  matchingFseibansByMachineNameCache.clear();
}
