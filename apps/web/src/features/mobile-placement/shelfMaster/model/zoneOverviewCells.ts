import { entityAtCell } from './shelfLayoutGrid';

import type { DraftEntity } from './shelfLayoutTypes';

export type ZoneOverviewCell = {
  entity: DraftEntity | null;
};

/** 俯瞰ミニマップ用: 各セル index に割り当て entity（未配置は null） */
export function buildZoneOverviewCells(entities: DraftEntity[], gridSize: number): ZoneOverviewCell[] {
  const max = gridSize * gridSize;
  return Array.from({ length: max }, (_, cellIndex) => ({
    entity: entityAtCell(entities, cellIndex)
  }));
}
