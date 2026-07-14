import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';

import type { SelfInspectionParticipantEmployee } from './self-inspection-participant-names.js';

type ParticipantNameRow = {
  session_id: string;
  name: string;
};

type ParticipantSummaryRow = {
  session_id: string;
  kind: 'employee' | 'name';
  employee_id: string | null;
  name: string;
};

export type SelfInspectionParticipantSummary = {
  participantEmployeeNames: string[];
  participantEmployees: SelfInspectionParticipantEmployee[];
};

export function groupParticipantEmployeeNamesBySessionId(
  rows: readonly ParticipantNameRow[]
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const names = map.get(row.session_id) ?? [];
    names.push(row.name);
    map.set(row.session_id, names);
  }
  return map;
}

export function groupParticipantSummariesBySessionId(
  rows: readonly ParticipantSummaryRow[]
): Map<string, SelfInspectionParticipantSummary> {
  const map = new Map<string, SelfInspectionParticipantSummary>();
  for (const row of rows) {
    const summary = map.get(row.session_id) ?? {
      participantEmployeeNames: [],
      participantEmployees: []
    };
    if (row.kind === 'name') {
      summary.participantEmployeeNames.push(row.name);
    } else if (row.employee_id) {
      summary.participantEmployees.push({ employeeId: row.employee_id, displayName: row.name });
    }
    map.set(row.session_id, summary);
  }
  return map;
}

/**
 * 一覧向け: セッションごとの測定者氏名を entryIndex 昇順・重複除去で返す。
 * 全 entry を include せず、DB 側で先頭出現のみに絞る。
 */
export async function loadParticipantSummariesBySessionIds(
  sessionIds: readonly string[]
): Promise<Map<string, SelfInspectionParticipantSummary>> {
  if (sessionIds.length === 0) {
    return new Map();
  }
  const rows = await prisma.$queryRaw<ParticipantSummaryRow[]>`
    WITH source AS (
      SELECT
        e."sessionId" AS session_id,
        e."createdByEmployeeId" AS employee_id,
        TRIM(e."createdByEmployeeNameSnapshot") AS name,
        e."entryIndex" AS entry_index
      FROM "SelfInspectionLotEntry" e
      WHERE e."sessionId" IN (${Prisma.join(sessionIds)})
        AND TRIM(COALESCE(e."createdByEmployeeNameSnapshot", '')) <> ''
    ), ranked_names AS (
      SELECT
        source.*,
        ROW_NUMBER() OVER (
          PARTITION BY session_id, name
          ORDER BY entry_index ASC
        ) AS rn
      FROM source
    ), ranked_employees AS (
      SELECT
        source.*,
        ROW_NUMBER() OVER (
          PARTITION BY session_id, employee_id
          ORDER BY entry_index ASC
        ) AS rn
      FROM source
      WHERE employee_id IS NOT NULL
    ), participants AS (
      SELECT session_id, 'name'::text AS kind, NULL::text AS employee_id, name, entry_index
      FROM ranked_names
      WHERE rn = 1
      UNION ALL
      SELECT session_id, 'employee'::text AS kind, employee_id, name, entry_index
      FROM ranked_employees
      WHERE rn = 1
    )
    SELECT session_id, kind, employee_id, name
    FROM participants
    ORDER BY session_id, entry_index, kind DESC
  `;
  return groupParticipantSummariesBySessionId(rows);
}
