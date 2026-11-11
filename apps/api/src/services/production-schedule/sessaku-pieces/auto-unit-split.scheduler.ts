import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { autoSplitSessakuUnits } from './auto-unit-split.service.js';

const START_DELAY_MS = 30000;
const ACTIVE_INTERVAL_MS = 1000;
const IDLE_INTERVAL_MS = 60000;
let activeWake: (() => void) | undefined;

/** Legacy pages can only bring forward a running leader's next round. */
export function wakeSessakuAutoUnitSplit(): void {
  activeWake?.();
}

export function createSessakuAutoUnitSplitScheduler() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scheduledAt = Infinity;
  let running: Promise<void> | undefined;
  let stopped = false;
  let started = false;
  let wakeRequested = false;

  const schedule = (delayMs: number) => {
    if (stopped) return;
    const due = Date.now() + delayMs;
    if (timer && scheduledAt <= due) return;
    if (timer) clearTimeout(timer);
    scheduledAt = due;
    timer = setTimeout(() => {
      timer = undefined;
      scheduledAt = Infinity;
      running = run();
    }, delayMs);
    timer.unref();
  };
  const wake = () => {
    if (stopped || !started) return;
    if (running) wakeRequested = true;
    else schedule(ACTIVE_INTERVAL_MS);
  };
  const run = async () => {
    let hasMore = false;
    let delayed = false;
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
        if (stopped) return;
        if (!siteKey.trim()) continue;
        let yieldReason: string | null = null;
        try {
          const result = await autoSplitSessakuUnits({ siteKey, onYield: reason => { yieldReason = reason; } });
          hasMore ||= result.hasMore;
          const runnerBusy = yieldReason === 'runner_busy';
          delayed ||= yieldReason !== null && !['human_write', 'AUTO_UNIT_SPLIT_BUDGET', 'disabled'].includes(yieldReason);
          logger.info({ event: 'sessaku_piece.auto_unit_split_background', siteKey, ...result, yieldReason },
            'Automatic unit split background round');
          // Another process owns the global runner lock, so do not probe more sites now.
          if (runnerBusy) break;
        } catch (err) {
          delayed = true;
          logger.warn({ event: 'sessaku_piece.auto_unit_split_background_error', siteKey, err },
            'Automatic unit split background round failed');
        }
      }
    } catch (err) {
      delayed = true;
      logger.warn({ event: 'sessaku_piece.auto_unit_split_background_error', err },
        'Automatic unit split site discovery failed');
    } finally {
      running = undefined;
      const delayMs = !delayed && (hasMore || wakeRequested) ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
      wakeRequested = false;
      schedule(delayMs);
    }
  };
  return {
    start() {
      if (process.env.SESSAKU_PIECES_CREATE_ENABLED !== 'true' || started || stopped) return;
      started = true;
      activeWake = wake;
      schedule(START_DELAY_MS);
    },
    async stop() {
      stopped = true;
      if (activeWake === wake) activeWake = undefined;
      if (timer) clearTimeout(timer);
      timer = undefined;
      await running;
    }
  };
}
