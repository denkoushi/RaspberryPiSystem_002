import { performance } from 'node:perf_hooks';

import { logger } from '../../lib/logger.js';

export function isGrindingPlanningBoardPerformanceLogEnabled(): boolean {
  const value = process.env.GRINDING_PLANNING_BOARD_PERF_LOG?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

export type GrindingPlanningBoardPerformance = {
  measure<T>(phase: string, work: () => Promise<T>): Promise<T>;
  flush(fields?: Record<string, unknown>): void;
};

/** 製番ボード 1 リクエストの段階別時間を 1 行で記録する（計測時だけ有効）。 */
export function createGrindingPlanningBoardPerformance(route: string): GrindingPlanningBoardPerformance {
  const enabled = isGrindingPlanningBoardPerformanceLogEnabled();
  const startedAt = performance.now();
  const phasesMs: Record<string, number> = {};
  return {
    async measure(phase, work) {
      if (!enabled) return work();
      const phaseStartedAt = performance.now();
      try {
        return await work();
      } finally {
        phasesMs[phase] = Math.round((phasesMs[phase] ?? 0) + performance.now() - phaseStartedAt);
      }
    },
    flush(fields) {
      if (!enabled) return;
      logger.info(
        { component: 'grindingPlanningBoardPerformance', route, totalMs: Math.round(performance.now() - startedAt), phasesMs, ...fields },
        '[grinding-planning-board-performance]'
      );
    }
  };
}
