import { describe, expect, it } from 'vitest';

import { resetSelfInspectionMachineBoardScheduleRowCaches } from '../self-inspection-machine-board.repository.js';

describe('self-inspection-machine-board.repository', () => {
  it('resetSelfInspectionMachineBoardScheduleRowCaches is safe to call', () => {
    expect(() => resetSelfInspectionMachineBoardScheduleRowCaches()).not.toThrow();
  });
});
