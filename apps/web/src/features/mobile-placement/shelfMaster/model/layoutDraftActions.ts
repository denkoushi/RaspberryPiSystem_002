
import { previewShelfFields } from './draftShelfPreview';
import { stripSelectedCells, releaseLayoutCells } from './layoutCellRelease';
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
  | { ok: true; entities: DraftEntity[]; assignedShelfCodeRaw?: string }
  | { ok: false; error: string };

export { clearAssignmentsOnCells, releaseLayoutCells } from './layoutCellRelease';

export function applyLayoutAssignment(input: ApplyAssignmentInput): ApplyAssignmentResult {
  const sorted = [...input.selectedCells].sort((a, b) => a - b);
  if (sorted.length === 0 || !input.pendingKind) {
    return { ok: false, error: '選択または種別が不足しています' };
  }

  if (input.pendingKind === 'UNUSED') {
    return {
      ok: true,
      entities: releaseLayoutCells(input.draftEntities, input.selectedCells)
    };
  }

  const withoutOverlap = stripSelectedCells(input.draftEntities, sorted);

  if (input.pendingKind === 'AISLE') {
    return {
      ok: true,
      entities: [
        ...withoutOverlap,
        {
          entityKind: 'AISLE',
          cellIndices: sorted,
          resourceCd: null,
          resourceName: null,
          shelfCodeRaw: null,
          displayLabel: null,
          aisleLabel: '通路'
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
      ],
      assignedShelfCodeRaw: preview.shelfCodeRaw
    };
  }

  return { ok: false, error: '不明な種別です' };
}
