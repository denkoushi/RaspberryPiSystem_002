import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';

type ParticipantNameRow = {
  session_id: string;
  name: string;
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

/**
 * 一覧向け: セッションごとの測定者氏名を entryIndex 昇順・重複除去で返す。
 * 全 entry を include せず、DB 側で先頭出現のみに絞る。
 */
export async function loadParticipantEmployeeNamesBySessionIds(
  sessionIds: readonly string[]
): Promise<Map<string, string[]>> {
  if (sessionIds.length === 0) {
    return new Map();
  }
  const rows = await prisma.$queryRaw<ParticipantNameRow[]>`
    WITH ranked AS (
      SELECT
        e."sessionId" AS session_id,
        TRIM(e."createdByEmployeeNameSnapshot") AS name,
        e."entryIndex" AS entry_index,
        ROW_NUMBER() OVER (
          PARTITION BY e."sessionId", TRIM(e."createdByEmployeeNameSnapshot")
          ORDER BY e."entryIndex" ASC
        ) AS rn
      FROM "SelfInspectionLotEntry" e
      WHERE e."sessionId" IN (${Prisma.join(sessionIds)})
        AND TRIM(COALESCE(e."createdByEmployeeNameSnapshot", '')) <> ''
    )
    SELECT session_id, name
    FROM ranked
    WHERE rn = 1
    ORDER BY session_id, entry_index
  `;
  return groupParticipantEmployeeNamesBySessionId(rows);
}
