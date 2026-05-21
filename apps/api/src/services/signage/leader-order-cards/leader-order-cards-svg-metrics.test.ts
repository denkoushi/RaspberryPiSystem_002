import { describe, expect, it } from 'vitest';

import { LEADER_ORDER_SIGNAGE_GRID_CAPACITY } from './layout-contracts.js';
import { computeLeaderOrderSignageSvgMetrics } from './leader-order-cards-svg-metrics.js';

describe('leader-order-cards-svg-metrics', () => {
  it('computes 5x2 grid with slotCount capped by capacity', () => {
    const m = computeLeaderOrderSignageSvgMetrics(1920, 1080);
    expect(m.gridSlots.length).toBe(LEADER_ORDER_SIGNAGE_GRID_CAPACITY);
    expect(m.slotCount).toBe(LEADER_ORDER_SIGNAGE_GRID_CAPACITY);
    expect(m.scale).toBe(1);
    expect(m.gridSlots[0].col).toBe(0);
    expect(m.gridSlots[0].row).toBe(0);
    expect(m.gridSlots[9].col).toBe(4);
    expect(m.gridSlots[9].row).toBe(1);
  });
});
