import { describe, expect, it } from 'vitest';

import { runExclusiveSchedulerTick } from '../exclusive-scheduler-tick.js';

describe('runExclusiveSchedulerTick', () => {
  it('skips overlapping executions', async () => {
    const state = { locked: false };

    const delays: number[] = [];
    const p1 = runExclusiveSchedulerTick(state, undefined, 'Test', async () => {
      await new Promise((r) => setTimeout(r, 50));
      delays.push(1);
    });
    const p2 = runExclusiveSchedulerTick(state, undefined, 'Test', async () => {
      delays.push(2);
    });

    await Promise.all([p1, p2]);

    expect(delays).toEqual([1]);
    expect(state.locked).toBe(false);
  });
});
