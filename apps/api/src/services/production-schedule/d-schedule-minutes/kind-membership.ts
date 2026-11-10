import { prisma } from '../../../lib/prisma.js';
import type { DScheduleMinutesKind } from './minutes-kind.js';

export async function listDScheduleMinutesKinds(input: {
  csvDashboardId: string;
  fseibans?: string[];
}): Promise<Map<string, DScheduleMinutesKind[]>> {
  const rows = await prisma.productionScheduleDScheduleMinutesKindMembership.findMany({
    where: {
      csvDashboardId: input.csvDashboardId,
      ...(input.fseibans ? { fseiban: { in: input.fseibans } } : {})
    },
    select: { fseiban: true, kind: true },
    orderBy: { kind: 'asc' }
  });
  const result = new Map<string, DScheduleMinutesKind[]>();
  for (const { fseiban, kind } of rows) {
    if (kind !== 'D_COMPANY' && kind !== 'INTERNAL') continue;
    const kinds = result.get(fseiban) ?? [];
    kinds.push(kind);
    result.set(fseiban, kinds);
  }
  return result;
}
