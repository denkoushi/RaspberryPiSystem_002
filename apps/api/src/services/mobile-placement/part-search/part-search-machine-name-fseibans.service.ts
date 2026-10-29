import { normalizeMachineNameForPartSearch } from '@raspi-system/part-search-core';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { buildMaxProductNoWinnerCondition } from '../../production-schedule/row-resolver/index.js';
import { findSupplementMachineNamesForMissing } from '../../production-schedule/seiban-machine-name-supplement-backfill.js';
import { isMissingSeibanMachineName } from '../../production-schedule/seiban-machine-name-state.js';

type MachineRow = {
  fseiban: string | null;
  machineName: string | null;
};

/** Shared MH/SH winner and supplement resolution for server search and device snapshots. */
export async function resolvePartSearchMachineNames(requestedFseibans?: string[]): Promise<Map<string, string>> {
  const rows = await prisma.$queryRaw<MachineRow[]>`
    SELECT
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban",
      MIN(("CsvDashboardRow"."rowData"->>'FHINMEI')) FILTER (
        WHERE (
            UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) LIKE 'MH%'
            OR UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) LIKE 'SH%'
          )
          AND ("CsvDashboardRow"."rowData"->>'FHINMEI') IS NOT NULL
          AND ("CsvDashboardRow"."rowData"->>'FHINMEI') <> ''
      ) AS "machineName"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
    GROUP BY ("CsvDashboardRow"."rowData"->>'FSEIBAN')
  `;

  const present = new Set(rows.map((row) => row.fseiban?.trim()));
  for (const fseiban of requestedFseibans ?? []) {
    if (fseiban && !present.has(fseiban)) { rows.push({ fseiban, machineName: null }); present.add(fseiban); }
  }
  const supplementMachineNames = await findSupplementMachineNamesForMissing(
    rows.map((row) => [row.fseiban, row.machineName] as const)
  );

  const out = new Map<string, string>();
  for (const row of rows) {
    const fs = row.fseiban?.trim() ?? '';
    if (fs.length === 0) {
      continue;
    }
    const machineName = isMissingSeibanMachineName(row.machineName)
      ? (supplementMachineNames.get(fs) ?? row.machineName)
      : row.machineName;
    out.set(fs, machineName ?? '');
  }
  return out;
}

export async function resolveFseibansMatchingMachineNameQuery(machineQueryRaw: string): Promise<Set<string>> {
  const needle = normalizeMachineNameForPartSearch(machineQueryRaw);
  if (!needle) return new Set();
  const names = await resolvePartSearchMachineNames();
  return new Set([...names].filter(([, name]) => normalizeMachineNameForPartSearch(name).includes(needle)).map(([fs]) => fs));
}
