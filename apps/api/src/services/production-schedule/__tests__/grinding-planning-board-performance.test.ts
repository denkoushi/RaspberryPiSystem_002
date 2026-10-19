import { afterEach, describe, expect, it, vi } from 'vitest';

const info = vi.fn();
vi.mock('../../../lib/logger.js', () => ({ logger: { info: (...args: unknown[]) => info(...args) } }));

import { createGrindingPlanningBoardPerformance } from '../grinding-planning-board-performance.js';

describe('createGrindingPlanningBoardPerformance', () => {
  afterEach(() => {
    delete process.env.GRINDING_PLANNING_BOARD_PERF_LOG;
    info.mockClear();
  });

  it('logs one line with per-phase durations when enabled', async () => {
    process.env.GRINDING_PLANNING_BOARD_PERF_LOG = 'true';
    const perf = createGrindingPlanningBoardPerformance('grinding-planning-board');

    await expect(perf.measure('source', async () => 'rows')).resolves.toBe('rows');
    await perf.measure('source', async () => undefined);
    await perf.measure('loadSummaryCompute', async () => []);
    await perf.measure('loadSummaryCacheHit', async () => []);
    perf.flush({ itemCount: 3 });

    expect(info).toHaveBeenCalledTimes(1);
    const [fields] = info.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ component: 'grindingPlanningBoardPerformance', route: 'grinding-planning-board', itemCount: 3 });
    expect(fields.phasesMs).toEqual({ source: expect.any(Number), loadSummaryCompute: expect.any(Number), loadSummaryCacheHit: expect.any(Number) });
  });

  it('stays silent and still returns results when disabled', async () => {
    const perf = createGrindingPlanningBoardPerformance('grinding-planning-board');
    await expect(perf.measure('source', async () => 1)).resolves.toBe(1);
    perf.flush();
    expect(info).not.toHaveBeenCalled();
  });
});
