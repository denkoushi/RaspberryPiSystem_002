import { createContext, useContext } from 'react';

import type { KioskResourceProgressProcessChip } from '../../../components/kiosk/resourceProgress/KioskResourceProcessChips';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

/** 部品キー（planningBoardPartKey）ごとの、進捗一覧と同じ資源CDチップ。 */
export type PlanningBoardProcessChipsByPart = ReadonlyMap<string, readonly KioskResourceProgressProcessChip[]>;

export const PlanningBoardProcessChipsContext = createContext<PlanningBoardProcessChipsByPart>(new Map());

export const usePlanningBoardProcessChips = (): PlanningBoardProcessChipsByPart => useContext(PlanningBoardProcessChipsContext);


/** 部品キーごとの置き場所。同じ部品の別工程の行に付いた配膳記録もまとめる。 */
export type PlanningBoardPlacementByPart = ReadonlyMap<string, NonNullable<GrindingPlanningBoardItem['placement']>>;

export const PlanningBoardPlacementContext = createContext<PlanningBoardPlacementByPart>(new Map());

export const usePlanningBoardPlacementByPart = (): PlanningBoardPlacementByPart => useContext(PlanningBoardPlacementContext);
