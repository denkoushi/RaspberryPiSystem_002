import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

export const PRODUCTION_SCHEDULE_COMPLETE_DAY_MESSAGE_COUNT = 4;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

type PresenceRun = {
  status: string;
  messageId: string | null;
  rowSeenRecordedAt: Date | null;
  sourceReceivedAt: Date | null;
  startedAt: Date;
};

export function resolveScheduleRowPresence(runs: readonly PresenceRun[]): { key: string; cutoff: Date | null } {
  const messagesByDay = new Map<string, Set<string>>();
  for (const run of runs) {
    if (run.status !== 'COMPLETED' || run.rowSeenRecordedAt == null || run.messageId == null) continue;
    const day = new Date((run.sourceReceivedAt ?? run.startedAt).getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
    const messages = messagesByDay.get(day) ?? new Set<string>();
    messages.add(run.messageId);
    messagesByDay.set(day, messages);
  }
  const day = [...messagesByDay].filter(([, messages]) => messages.size === PRODUCTION_SCHEDULE_COMPLETE_DAY_MESSAGE_COUNT)
    .map(([day]) => day).sort().at(-1);
  return day ? { key: day, cutoff: new Date(`${day}T00:00:00+09:00`) } : { key: 'none', cutoff: null };
}

export async function readScheduleRowPresence(client: Pick<Prisma.TransactionClient, 'csvDashboardIngestRun'> = prisma) {
  const runs = await client.csvDashboardIngestRun.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, status: 'COMPLETED', rowSeenRecordedAt: { not: null }, messageId: { not: null } },
    select: { status: true, messageId: true, rowSeenRecordedAt: true, sourceReceivedAt: true, startedAt: true }
  });
  return resolveScheduleRowPresence(runs);
}

export function buildScheduleRowPresenceCondition(cutoff: Date | null): Prisma.Sql {
  return cutoff == null ? Prisma.sql`TRUE` : Prisma.sql`EXISTS (
    SELECT 1 FROM "ProductionScheduleRowSeen" s
    WHERE s."dataHash" = "CsvDashboardRow"."dataHash" AND s."lastSeenAt" >= ${cutoff}
  )`;
}
