vi.mock('../../config/env/load-dotenv.js', () => ({}));
import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { leaderboardShellSnapshotStore } from '../../services/production-schedule/leaderboard/kiosk-leaderboard-snapshot-store.js';
import { createGrindingPlanningBoardStartupWarmup } from '../../services/production-schedule/grinding-planning-board/startup-warmup.js';

vi.mock('../../services/production-schedule/grinding-planning-board/startup-warmup.js', () => ({
  createGrindingPlanningBoardStartupWarmup: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() }))
}));
import {
  SchedulerStartupCleanupError,
  SchedulerStepStateAmbiguousError,
} from '../scheduler-errors.js';
import {
  buildPostListenSchedulerDefinitions,
  listPostListenSchedulerNames,
  startSchedulerStepGroup,
  stopSchedulerStepGroup,
  type SchedulerStepDefinition,
} from '../start-post-listen-schedulers.js';

function trackedSteps(
  names: string[],
  options?: {
    failStartAt?: string;
    failStopNames?: string[];
  }
): {
  definitions: SchedulerStepDefinition[];
  stopOrder: string[];
  startOrder: string[];
} {
  const stopOrder: string[] = [];
  const startOrder: string[] = [];
  const failStop = new Set(options?.failStopNames ?? []);

  const definitions = names.map((name) => ({
    name,
    start: async () => {
      if (options?.failStartAt === name) {
        throw new Error(`${name} failed to start`);
      }
      startOrder.push(name);
    },
    stop: async () => {
      stopOrder.push(name);
      if (failStop.has(name)) {
        throw new Error(`${name} failed to stop`);
      }
    },
  }));

  return { definitions, stopOrder, startOrder };
}

describe('start-post-listen-schedulers fail-closed group', () => {
  it('wires warmup to the kiosk route snapshot store and registers its shutdown', async () => {
    const definition = buildPostListenSchedulerDefinitions({} as FastifyInstance)
      .find((step) => step.name === 'grinding-planning-board-startup-warmup')!;
    expect(createGrindingPlanningBoardStartupWarmup).toHaveBeenCalledWith({
      enabled: env.GRINDING_PLANNING_BOARD_STARTUP_WARMUP_ENABLED,
      delayMs: env.GRINDING_PLANNING_BOARD_STARTUP_WARMUP_DELAY_MS,
      snapshotStore: leaderboardShellSnapshotStore
    });
    const warmup = vi.mocked(createGrindingPlanningBoardStartupWarmup).mock.results.at(-1)!.value;
    await definition.start();
    await definition.stop();
    expect(warmup.start).toHaveBeenCalledOnce();
    expect(warmup.stop).toHaveBeenCalledOnce();
  });

  it('includes backup and csv-import in the registered scheduler group', () => {
    const names = listPostListenSchedulerNames();
    expect(names).toContain('backup');
    expect(names).toContain('client-network-log-retention');
    expect(names).toContain('watch-camera-retention');
    expect(buildPostListenSchedulerDefinitions({} as FastifyInstance).some((step) => step.name === 'watch-camera-retention')).toBe(true);
    expect(names).toContain('csv-import');
  });

  it('stops started steps in reverse order', async () => {
    const { definitions, stopOrder, startOrder } = trackedSteps(['a', 'b', 'c', 'backup', 'csv-import']);
    const steps = await startSchedulerStepGroup(definitions);
    expect(startOrder).toEqual(['a', 'b', 'c', 'backup', 'csv-import']);

    await stopSchedulerStepGroup(steps);
    expect(stopOrder).toEqual(['csv-import', 'backup', 'c', 'b', 'a']);
  });

  it('collects multiple stop failures into AggregateError while still stopping every step', async () => {
    const { definitions, stopOrder } = trackedSteps(['a', 'b', 'c'], {
      failStopNames: ['a', 'c'],
    });
    const steps = await startSchedulerStepGroup(definitions);

    await expect(stopSchedulerStepGroup(steps)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AggregateError);
      const aggregate = error as AggregateError;
      expect(aggregate.errors).toHaveLength(2);
      expect(stopOrder).toEqual(['c', 'b', 'a']);
      return true;
    });
  });

  it('throws SchedulerStartupCleanupError when startup rollback cannot prove stop', async () => {
    const { definitions, stopOrder } = trackedSteps(['a', 'b', 'c'], {
      failStartAt: 'c',
      failStopNames: ['a'],
    });

    await expect(startSchedulerStepGroup(definitions)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SchedulerStartupCleanupError);
      const cleanup = error as SchedulerStartupCleanupError;
      expect(cleanup.causeErrors.length).toBeGreaterThanOrEqual(2);
      expect(stopOrder).toEqual(['b', 'a']);
      return true;
    });
  });

  it('rethrows the original start error when rollback stops cleanly', async () => {
    const { definitions, stopOrder } = trackedSteps(['a', 'b', 'c'], {
      failStartAt: 'c',
    });

    await expect(startSchedulerStepGroup(definitions)).rejects.toThrow('c failed to start');
    expect(stopOrder).toEqual(['b', 'a']);
  });

  it('promotes a step-owned ambiguous startup failure even when prior steps stop cleanly', async () => {
    const { definitions, stopOrder } = trackedSteps(['a', 'b']);
    definitions.push({
      name: 'signage-render',
      start: async () => {
        throw new SchedulerStepStateAmbiguousError('signage-render', [
          new Error('worker readiness failed'),
          new Error('worker stop timed out'),
        ]);
      },
      stop: () => undefined,
    });

    await expect(startSchedulerStepGroup(definitions)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SchedulerStartupCleanupError);
      const cleanup = error as SchedulerStartupCleanupError;
      expect(cleanup.causeErrors.map((entry) => entry.message)).toEqual([
        'worker readiness failed',
        'worker stop timed out',
      ]);
      expect(stopOrder).toEqual(['b', 'a']);
      return true;
    });
  });
});

describe('start-post-listen-schedulers naming contract', () => {
  it('keeps a stable ordered membership for Blue/Green stop guarantees', () => {
    expect(listPostListenSchedulerNames()).toEqual([
      'hermes-knowledge',
      'signage-render',
      'part-measurement-drawing-dimension-map',
      'grinding-planning-board-startup-warmup',
      'procedure-term-learning',
      'business-hermes-nightly',
      'security-review-nightly',
      'fkojunst-mail-superseded-prune',
      'file-storage-integrity-backfill',
      'backup',
      'csv-import',
      'kiosk-document-gmail',
      'procedure-video',
      'kiosk-document-ocr',
      'work-instruction-gmail',
      'gmail-trash-cleanup',
      'due-management-tuning',
      'alerts-dispatcher',
      'watch-camera-retention',
      'client-network-log-retention',
      'client-heartbeat-monitor',
      'system-notice-evaluator',
      'csv-feed-freshness-evaluator',
      'alerts-ingestor',
      'photo-tool-label',
      'procedure-material-image-description',
      'part-measurement-drawing-ocr',
    ]);
  });
});
