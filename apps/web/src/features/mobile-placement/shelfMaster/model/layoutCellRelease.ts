import type { DraftEntity } from './shelfLayoutTypes';

/** 選択マスを各 entity の cellIndices から除去し、空になった entity を落とす */
export function stripSelectedCells(entities: DraftEntity[], sorted: number[]): DraftEntity[] {
  const remove = new Set(sorted);
  return entities
    .map((e) => ({
      ...e,
      cellIndices: e.cellIndices.filter((i) => !remove.has(i))
    }))
    .filter((e) => e.cellIndices.length > 0);
}

/**
 * 選択マスの用途を外し、1マスずつの空マス（entity なし）に戻す。
 * buildRenderItems が未配置マスを個別に描画する。
 */
export function releaseLayoutCells(
  draftEntities: DraftEntity[],
  selectedCells: number[]
): DraftEntity[] {
  if (selectedCells.length === 0) {
    return draftEntities;
  }
  const sorted = [...selectedCells].sort((a, b) => a - b);
  return stripSelectedCells(draftEntities, sorted);
}

/** @deprecated 正名は releaseLayoutCells */
export function clearAssignmentsOnCells(
  draftEntities: DraftEntity[],
  selectedCells: number[]
): DraftEntity[] {
  return releaseLayoutCells(draftEntities, selectedCells);
}
