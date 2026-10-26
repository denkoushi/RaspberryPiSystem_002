import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import type { LeaderboardShellSnapshotStore } from '../leaderboard/leaderboard-shell-snapshot.store.js';
import { getGrindingPlanningBoardLoad, warmGrindingPlanningBoardPayload } from './read.js';

export function createGrindingPlanningBoardStartupWarmup(options: {
  enabled: boolean;
  delayMs: number;
  snapshotStore: LeaderboardShellSnapshotStore;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let stopped = false;
  let started = false;

  const run = async () => {
    try {
      const sites = await prisma.$queryRaw<Array<{ siteKey: string }>>(Prisma.sql`
        SELECT "siteKey" FROM "ProductionScheduleGrindingPlanningBoardState"
        WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        UNION
        SELECT "siteKey" FROM "ProductionScheduleGrindingPlanningBoardOverride"
        WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        ORDER BY "siteKey"
      `);
      for (const { siteKey } of sites) {
        if (!siteKey.trim()) continue;
        // The page starts in resource/incomplete with a separate load request.
        // Categories are client-side switches, not persisted in board state.
        for (const category of ['grinding', 'cutting', 'all'] as const) {
          if (stopped) return;
          try {
            await warmGrindingPlanningBoardPayload({
              siteKey, category, view: 'resource', completionFilter: 'incomplete',
              includeLoad: false, snapshotStore: options.snapshotStore
            });
          } catch (error) {
            logger.warn({ err: error, siteKey, category }, 'Grinding planning board startup payload warmup failed');
          }
          if (stopped) return;
          try {
            await getGrindingPlanningBoardLoad({ siteKey, category });
          } catch (error) {
            logger.warn({ err: error, siteKey, category }, 'Grinding planning board startup load warmup failed');
          }
        }
      }
    } catch (error) {
      logger.warn({ err: error }, 'Grinding planning board startup warmup failed');
    }
  };

  return {
    start() {
      if (!options.enabled || started || stopped) return;
      started = true;
      timer = setTimeout(() => {
        timer = undefined;
        running = run();
      }, options.delayMs);
      timer.unref();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      // Drain the current read before Prisma disconnects; do not start another.
      await running;
    }
  };
}
