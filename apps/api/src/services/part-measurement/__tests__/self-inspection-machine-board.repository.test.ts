import { beforeEach, describe, expect, it, vi } from 'vitest';

const clearAutoRotationVmCache = vi.hoisted(() => vi.fn());

vi.mock('../self-inspection-machine-board-auto-rotation.cache.js', () => ({
  clearAutoRotationVmCache,
}));

import { resetSelfInspectionMachineBoardScheduleRowCaches } from '../self-inspection-machine-board-cache-invalidation.js';

describe('self-inspection-machine-board.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resetSelfInspectionMachineBoardScheduleRowCaches is safe to call', () => {
    expect(() => resetSelfInspectionMachineBoardScheduleRowCaches()).not.toThrow();
  });

  it('clears auto rotation cache on reset', () => {
    resetSelfInspectionMachineBoardScheduleRowCaches();
    expect(clearAutoRotationVmCache).toHaveBeenCalledTimes(1);
  });
});
