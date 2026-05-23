import { entityAtCell } from '../model/shelfLayoutGrid';

import type { DraftEntity } from '../model/shelfLayoutTypes';

export type ShelfSelectionContext =
  | { kind: 'none' }
  | { kind: 'empty' }
  | {
      kind: 'shelf';
      shelfCodeRaw: string;
      displayLabel: string | null;
      /** 選択セルが単一 SHELF entity に属する */
      singleEntity: boolean;
    };

/**
 * 地図の選択セルから、Zero2W 担当棚の対象棚を解決する。
 */
export function resolveShelfSelectionContext(
  selectedCells: number[],
  draftEntities: DraftEntity[]
): ShelfSelectionContext {
  if (selectedCells.length === 0) {
    return { kind: 'none' };
  }

  const entities = new Map<string, DraftEntity>();
  for (const cell of selectedCells) {
    const entity = entityAtCell(draftEntities, cell);
    if (!entity) {
      return { kind: 'empty' };
    }
    entities.set(entity.shelfCodeRaw ?? entity.displayLabel ?? entity.entityKind, entity);
  }

  if (entities.size !== 1) {
    return { kind: 'none' };
  }

  const shelf = [...entities.values()][0]!;
  if (shelf.entityKind !== 'SHELF') {
    return { kind: 'none' };
  }
  const code = shelf.shelfCodeRaw?.trim() ?? '';
  if (code.length === 0) {
    return { kind: 'none' };
  }

  return {
    kind: 'shelf',
    shelfCodeRaw: code,
    displayLabel: shelf.displayLabel,
    singleEntity: true
  };
}
