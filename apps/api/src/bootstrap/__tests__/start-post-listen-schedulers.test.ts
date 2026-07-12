import { describe, expect, it } from 'vitest';
import { SchedulerStartupCleanupError } from '../scheduler-errors.js';
import {
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
  it('includes backup and csv-import in the registered scheduler group', () => {
    const names = listPostListenSchedulerNames();
    expect(names).toContain('backup');
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
});

describe('start-post-listen-schedulers naming contract', () => {
  it('keeps a stable ordered membership for Blue/Green stop guarantees', () => {
    expect(listPostListenSchedulerNames()).toEqual([
      'signage-render',
      'backup',
      'csv-import',
      'kiosk-document-gmail',
      'kiosk-document-ocr',
      'gmail-trash-cleanup',
      'due-management-tuning',
      'alerts-dispatcher',
      'alerts-ingestor',
      'photo-tool-label',
      'part-measurement-drawing-ocr',
    ]);
  });
});
