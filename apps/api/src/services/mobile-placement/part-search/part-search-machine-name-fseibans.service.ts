import { normalizeMachineNameForPartSearch } from '@raspi-system/part-search-core';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { buildMaxProductNoWinnerCondition } from '../../production-schedule/row-resolver/index.js';

type MachineRow = {
  fseiban: string | null;
  machineName: string | null;
};

/**
 * 生産スケジュール（MH/SH 行の FHINMEI 集約）から、機種名クエリに部分一致する FSEIBAN の集合を返す。
 * 表示は登録製番ボタン下段の機種名と同系の正規化（{@link normalizeMachineNameForPartSearch}）で比較する。
 */
export async function resolveFseibansMatchingMachineNameQuery(machineQueryRaw: string): Promise<Set<string>> {
  const needle = normalizeMachineNameForPartSearch(machineQueryRaw);
  if (needle.length === 0) {
    return new Set();
  }

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

  const out = new Set<string>();
  for (const row of rows) {
    const fs = row.fseiban?.trim() ?? '';
    if (fs.length === 0) {
      continue;
    }
    const mn = normalizeMachineNameForPartSearch(row.machineName);
    if (mn.includes(needle)) {
      out.add(fs);
    }
  }
  return out;
}
