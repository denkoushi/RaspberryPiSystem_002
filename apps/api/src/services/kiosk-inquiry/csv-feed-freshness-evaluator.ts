import * as path from 'node:path';
import { Prisma } from '@prisma/client';
import { runExclusiveSchedulerTick } from '../../lib/exclusive-scheduler-tick.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import { loadBackupConfigWithFkojunstImportScheduleEnsured } from '../imports/fkojunst-import-schedule.ensure.js';
import { deliverSystemNotice } from './system-notice.service.js';

export const CSV_FEED_EVALUATION_MS = 60 * 60 * 1000;
// Production raw files (9/1-10/21) showed at most 4.0 days without new lines on healthy daily feeds.
export const CSV_FEED_FROZEN_DAYS = 5;
export const CSV_FEED_MISSING_MIN_GRACE_MS = 48 * 60 * 60 * 1000;
export const CSV_FEED_INTERVAL_SAMPLE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 60;
const RUNS_PER_TICK = 500;
type FeedRun = { id: string; runAt: Date; csvFilePath: string | null };

async function readLines(run: FeedRun): Promise<Set<string> | null> {
  if (!run.csvFilePath) return null;
  try {
    const { root, store } = getFileStorageRuntime();
    const key = path.relative(root, run.csvFilePath).split(path.sep).join('/');
    const bytes = await store.read(key, { verifyIntegrity: true });
    return new Set(bytes.toString('latin1').split('\n').slice(1).map(line => line.replace(/\r$/, '')).filter(line => line !== ''));
  } catch (err) {
    logger.warn({ err, runId: run.id }, '[CsvFeedFreshness] Raw CSV unavailable');
    return null;
  }
}

export async function evaluateCsvFeedFreshness(now = new Date()): Promise<void> {
  const { config } = await loadBackupConfigWithFkojunstImportScheduleEnsured();
  const ids = [...new Set((config.csvImports ?? []).filter(entry => entry.enabled === true)
    .flatMap(entry => (entry.targets ?? []).filter(target => target.type === 'csvDashboards').map(target => target.source)))];
  if (!ids.length) return;
  const dashboards = await prisma.csvDashboard.findMany({
    where: { id: { in: ids }, enabled: true },
    select: { id: true, name: true, gmailSubjectPattern: true }
  });
  const windowStart = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);
  for (const dashboard of dashboards) {
    try {
      const label = dashboard.gmailSubjectPattern || dashboard.name;
      const title = `CSV取込 ${label}`;
      const completed = Prisma.sql`SELECT "id", "csvFilePath",
        COALESCE("sourceReceivedAt", "completedAt", "startedAt") AS "runAt"
        FROM "CsvDashboardIngestRun" WHERE "csvDashboardId" = ${dashboard.id} AND "status" = 'COMPLETED'`;
      const recent = await prisma.$queryRaw<FeedRun[]>(Prisma.sql`
        SELECT * FROM (${completed}) AS runs ORDER BY "runAt" DESC, "id" DESC LIMIT ${CSV_FEED_INTERVAL_SAMPLE + 1}`);
      let frozenAfterMs = CSV_FEED_FROZEN_DAYS * DAY_MS;
      if (recent.length >= 3) {
        const intervals = recent.slice(1).map((run, i) => recent[i].runAt.getTime() - run.runAt.getTime()).sort((a, b) => a - b);
        const middle = Math.floor(intervals.length / 2);
        const median = intervals.length % 2 ? intervals[middle] : (intervals[middle - 1] + intervals[middle]) / 2;
        const threshold = Math.max(2 * median, median + CSV_FEED_MISSING_MIN_GRACE_MS);
        // A weekly feed changes once per arrival, so "frozen" must outlast its own missing threshold.
        frozenAfterMs = Math.max(frozenAfterMs, threshold);
        const age = now.getTime() - recent[0].runAt.getTime();
        await deliverSystemNotice({ key: `csv-feed:${dashboard.id}:missing`, title,
          body: `「${label}」のCSVが ${Math.max(1, Math.floor(age / DAY_MS))}日 届いていません。メールで送っている自動フロー（Power Automate）が止まっていないか確認してください。`,
          state: age > threshold ? 'open' : 'recovered' }, now);
      }

      const state = await prisma.csvFeedFreshnessState.findUnique({ where: { csvDashboardId: dashboard.id } });
      const after = state?.lastComparedRunAt
        ? Prisma.sql`("runAt", "id") > (${state.lastComparedRunAt}, ${state.lastComparedRunId ?? ''})`
        : Prisma.sql`"runAt" >= ${windowStart}`;
      const pending = await prisma.$queryRaw<FeedRun[]>(Prisma.sql`
        SELECT * FROM (${completed}) AS runs WHERE ${after}
        ORDER BY "runAt" ASC, "id" ASC LIMIT ${RUNS_PER_TICK + 1}`);
      let lastContentChangedAt = state?.lastContentChangedAt ?? null;
      const batch = pending.slice(0, RUNS_PER_TICK);
      if (batch.length) {
        const [predecessor] = await prisma.$queryRaw<FeedRun[]>(Prisma.sql`
          SELECT * FROM (${completed}) AS runs WHERE ("runAt", "id") < (${batch[0].runAt}, ${batch[0].id})
          ${state?.lastComparedRunAt ? Prisma.empty : Prisma.sql`AND "runAt" >= ${windowStart}`}
          ORDER BY "runAt" DESC, "id" DESC LIMIT 1`);
        let previous = predecessor ? await readLines(predecessor) : null;
        for (const run of batch) {
          const current = await readLines(run);
          if (previous !== null && current !== null) {
            for (const line of current) {
              if (!previous.has(line)) {
                lastContentChangedAt = run.runAt;
                break;
              }
            }
          }
          previous = current;
        }
        const last = batch[batch.length - 1];
        const data = { lastComparedRunId: last.id, lastComparedRunAt: last.runAt, lastContentChangedAt };
        await prisma.csvFeedFreshnessState.upsert({ where: { csvDashboardId: dashboard.id },
          create: { csvDashboardId: dashboard.id, ...data }, update: data });
      }
      // Finish catch-up before issuing notices based on historical comparisons.
      if (lastContentChangedAt === null || pending.length > RUNS_PER_TICK) continue;
      const age = now.getTime() - lastContentChangedAt.getTime();
      const hasRecentRuns = recent.length > 0 && recent[0].runAt >= windowStart;
      await deliverSystemNotice({ key: `csv-feed:${dashboard.id}:frozen`, title,
        body: `「${label}」のCSVが ${Math.max(1, Math.floor(age / DAY_MS))}日間 同じ中身のままです。元のPower BIレポートの自動更新が止まっていないか確認してください。`,
        state: hasRecentRuns && age >= frozenAfterMs ? 'open' : 'recovered' }, now);
    } catch (err) {
      logger.warn({ err, csvDashboardId: dashboard.id }, '[CsvFeedFreshness] Evaluation failed');
    }
  }
}

export class CsvFeedFreshnessEvaluator {
  private timer: NodeJS.Timeout | null = null;
  private readonly tickExclusive = { locked: false };
  private running: Promise<void> | null = null;

  start(): void {
    if (process.env.NODE_ENV === 'test' || this.timer) return;
    const tick = () => {
      this.running = runExclusiveSchedulerTick(this.tickExclusive, logger, 'CsvFeedFreshnessEvaluator', () => evaluateCsvFeedFreshness())
        .catch(err => { logger.warn({ err }, '[CsvFeedFreshness] Scheduled evaluation failed'); });
    };
    tick();
    this.timer = setInterval(() => { if (!this.tickExclusive.locked) tick(); }, CSV_FEED_EVALUATION_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }
}

const evaluator = new CsvFeedFreshnessEvaluator();
export function getCsvFeedFreshnessEvaluator() { return evaluator; }
