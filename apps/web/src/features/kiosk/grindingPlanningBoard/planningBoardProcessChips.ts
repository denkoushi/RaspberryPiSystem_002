import { createContext, useContext } from 'react';

import type { KioskResourceProgressProcessChip } from '../../../components/kiosk/resourceProgress/KioskResourceProcessChips';

/** 部品キー（planningBoardPartKey）ごとの、進捗一覧と同じ資源CDチップ。 */
export type PlanningBoardProcessChipsByPart = ReadonlyMap<string, readonly KioskResourceProgressProcessChip[]>;

export const PlanningBoardProcessChipsContext = createContext<PlanningBoardProcessChipsByPart>(new Map());

export const usePlanningBoardProcessChips = (): PlanningBoardProcessChipsByPart => useContext(PlanningBoardProcessChipsContext);

