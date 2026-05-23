
import { previewShelfFields } from './draftShelfPreview';
import { entityAtCell } from './shelfLayoutGrid';

import type { DraftEntity } from './shelfLayoutTypes';
import type { MachineMasterDto } from '../../../../api/client';

export type ApplyAssignmentInput = {
  draftEntities: DraftEntity[];
  selectedCells: number[];
  pendingKind: DraftEntity['entityKind'];
  machines: MachineMasterDto[];
  selectedMachineCd: string;
  gridSize: 3 | 4;
  shelfPrefix: string;
  baseNextShelfSlot: number;
};

export type ApplyAssignmentResult =
  | { ok: true; entities: DraftEntity[] }
  | { ok: false; error: string };

function stripSelectedCells(entities: DraftEntity[], sorted: number[]): DraftEntity[] {
  return entities
    .map((e) => ({
      ...e,
      cellIndices: e.cellIndices.filter((i) => !sorted.includes(i))
    }))
    .filter((e) => e.cellIndices.length > 0);
}

export function applyLayoutAssignment(input: ApplyAssignmentInput): ApplyAssignmentResult {
  const sorted = [...input.selectedCells].sort((a, b) => a - b);
  if (sorted.length === 0 || !input.pendingKind) {
    return { ok: false, error: '選択または種別が不足しています' };
  }

  const withoutOverlap = stripSelectedCells(input.draftEntities, sorted);

  if (input.pendingKind === 'UNUSED' || input.pendingKind === 'AISLE') {
    return {
      ok: true,
      entities: [
        ...withoutOverlap,
        {
          entityKind: input.pendingKind,
          cellIndices: sorted,
          resourceCd: null,
          resourceName: null,
          shelfCodeRaw: null,
          displayLabel: null,
          aisleLabel: input.pendingKind === 'AISLE' ? '通路' : null
        }
      ]
    };
  }

  if (input.pendingKind === 'MACHINE') {
    const master = input.machines.find((m) => m.resourceCd === input.selectedMachineCd);
    if (!master) {
      return { ok: false, error: '加工機マスタを選択してください' };
    }
    return {
      ok: true,
      entities: [
        ...withoutOverlap,
        {
          entityKind: 'MACHINE',
          cellIndices: sorted,
          resourceCd: master.resourceCd,
          resourceName: master.resourceName,
          shelfCodeRaw: null,
          displayLabel: null,
          aisleLabel: null
        }
      ]
    };
  }

  if (input.pendingKind === 'SHELF') {
    const existing = sorted.map((i) => entityAtCell(input.draftEntities, i)).find((e) => e?.entityKind === 'SHELF');
    const preview = previewShelfFields({
      cellIndices: sorted,
      gridSize: input.gridSize,
      entities: withoutOverlap,
      shelfPrefix: input.shelfPrefix,
      baseNextShelfSlot: input.baseNextShelfSlot,
      existingShelfCodeRaw: existing?.shelfCodeRaw ?? null,
      existingDisplayLabel: existing?.displayLabel ?? null
    });
    return {
      ok: true,
      entities: [
        ...withoutOverlap,
        {
          entityKind: 'SHELF',
          cellIndices: sorted,
          resourceCd: null,
          resourceName: null,
          shelfCodeRaw: preview.shelfCodeRaw,
          displayLabel: preview.displayLabel,
          aisleLabel: null
        }
      ]
    };
  }

  return { ok: false, error: '不明な種別です' };
}

export function clearAssignmentsOnCells(
  draftEntities: DraftEntity[],
  selectedCells: number[]
): DraftEntity[] {
  if (selectedCells.length === 0) {
    return draftEntities;
  }
  return stripSelectedCells(draftEntities, selectedCells);
}
