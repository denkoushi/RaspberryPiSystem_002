import { previewShelfFields } from '../model/draftShelfPreview';
import { entityAtCell } from '../model/shelfLayoutGrid';

import { resolveShelfSelectionContext, type ShelfSelectionContext } from './shelfSelectionContext';

import type { DraftEntity } from '../model/shelfLayoutTypes';

export function resolveZero2wTargetShelfCodeRaw(input: {
  selectedCells: number[];
  draftEntities: DraftEntity[];
  pendingKind: DraftEntity['entityKind'] | null;
  gridSize: 3 | 4;
  shelfPrefix: string;
  baseNextShelfSlot: number;
}): string | null {
  const shelfContext: ShelfSelectionContext = resolveShelfSelectionContext(
    input.selectedCells,
    input.draftEntities
  );
  if (shelfContext.kind === 'shelf') {
    return shelfContext.shelfCodeRaw;
  }

  if (input.pendingKind !== 'SHELF' || input.selectedCells.length === 0) {
    return null;
  }

  const sorted = [...input.selectedCells].sort((a, b) => a - b);
  const existing = sorted.map((i) => entityAtCell(input.draftEntities, i)).find((e) => e?.entityKind === 'SHELF');
  const preview = previewShelfFields({
    cellIndices: sorted,
    gridSize: input.gridSize,
    entities: input.draftEntities,
    shelfPrefix: input.shelfPrefix,
    baseNextShelfSlot: input.baseNextShelfSlot,
    existingShelfCodeRaw: existing?.shelfCodeRaw ?? null,
    existingDisplayLabel: existing?.displayLabel ?? null
  });
  return preview.shelfCodeRaw;
}
