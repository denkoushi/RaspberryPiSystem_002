import { prisma } from '../../lib/prisma.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import { MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_ID } from '../imports/machine-signal-import-schedule.policy.js';

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 3_600_000;
export const MACHINE_SIGNAL_COVERAGE_DAYS = 60;

export type MachineSignalAdminOverviewDto = {
  latestReportDate: string | null;
  latestReportCount: number;
  /** 直近の日ごとの取り込み済み件数（古い順、今日まで）。抜けている日は 0 */
  coverage: Array<{ date: string; count: number }>;
  /** CSV取込の一覧にある設備稼働の行。無ければ null */
  gmailSchedule: { schedule: string; enabled: boolean } | null;
};

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

/** 管理画面の上段に出す、取り込みの状況。 */
export async function getMachineSignalAdminOverview(now: Date = new Date()): Promise<MachineSignalAdminOverviewDto> {
  const today = new Date(`${toDateKey(new Date(now.getTime() + JST_OFFSET_MS))}T00:00:00.000Z`);
  const start = new Date(today.getTime() - (MACHINE_SIGNAL_COVERAGE_DAYS - 1) * DAY_MS);
  const [latest, grouped, config] = await Promise.all([
    prisma.machineSignalDailyReport.findFirst({ orderBy: { reportDate: 'desc' }, select: { reportDate: true } }),
    prisma.machineSignalDailyReport.groupBy({
      by: ['reportDate'],
      where: { reportDate: { gte: start, lte: today } },
      _count: { _all: true },
    }),
    BackupConfigLoader.load(),
  ]);
  const counts = new Map(grouped.map((row) => [toDateKey(row.reportDate), row._count._all]));
  const coverage = Array.from({ length: MACHINE_SIGNAL_COVERAGE_DAYS }, (_, index) => {
    const date = toDateKey(new Date(start.getTime() + index * DAY_MS));
    return { date, count: counts.get(date) ?? 0 };
  });
  const latestReportCount = latest
    ? await prisma.machineSignalDailyReport.count({ where: { reportDate: latest.reportDate } })
    : 0;
  const row = (config.csvImports ?? []).find((schedule) => schedule.id === MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_ID);

  return {
    latestReportDate: latest ? toDateKey(latest.reportDate) : null,
    latestReportCount,
    coverage,
    gmailSchedule: row ? { schedule: row.schedule, enabled: row.enabled !== false } : null,
  };
}
