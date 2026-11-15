import { useMemo, useRef } from 'react';

import { PieceOperationBlockedError } from '../PlanningBoardPiecePopover';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

export { PlanningBoardUnitOpMutationContext } from './PlanningBoardUnitOpEditor';

type UnitOpMutationOptions = {
  refreshBoard: () => Promise<unknown>;
  /** True while another write, a piece operation or polling-sensitive state must block the save. */
  isBlocked: () => boolean;
  gate: { generation: () => number };
  begin: (item: GrindingPlanningBoardItem) => void;
  end: () => void;
};

// The page owns the piece write gates while the unit-op editor saves and refreshes the board.
export function usePlanningBoardUnitOpMutation(options: UnitOpMutationOptions) {
  const optionsRef = useRef(options); optionsRef.current = options;
  return useMemo(() => ({
    refreshBoard: () => optionsRef.current.refreshBoard(),
    run: async (item: GrindingPlanningBoardItem, save: () => Promise<unknown>) => {
      const { isBlocked, gate, begin } = optionsRef.current;
      if (isBlocked()) throw new PieceOperationBlockedError('保存中…');
      const generation = gate.generation();
      begin(item);
      try { return await save(); } finally {
        if (generation === optionsRef.current.gate.generation()) optionsRef.current.end();
      }
    }
  }), []);
}
