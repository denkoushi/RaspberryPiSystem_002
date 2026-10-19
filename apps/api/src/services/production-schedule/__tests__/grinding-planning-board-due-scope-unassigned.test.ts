import { describe, expect, it } from 'vitest';

import {
  getGrindingPlanningBoardDueScope,
  updateGrindingPlanningBoardDueScope,
} from '../grinding-planning-board-due-scope.service.js';

describe('unassigned seiban planning due scope', () => {
  it('rejects reads and writes that cannot identify a manufacturing order', async () => {
    await expect(getGrindingPlanningBoardDueScope({ siteKey: 'site', fseiban: '********' }))
      .rejects.toThrow('仮製番の納期一括編集は製造 order を区別できません');
    await expect(updateGrindingPlanningBoardDueScope({ siteKey: 'site', fseiban: '********', request: {} as never }))
      .rejects.toThrow('仮製番の納期一括編集は製造 order を区別できません');
  });
});
