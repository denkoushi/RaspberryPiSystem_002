import {
  allocateShelfCode,
  buildAutoDisplayLabel,
  indexToRc,
  type MachineAnchor
} from '@raspi-system/shelf-layout-core';

import type { DraftEntity } from './shelfLayoutTypes';

export function buildMachineAnchorsFromDraft(entities: DraftEntity[], gridSize: number): MachineAnchor[] {
  return entities.flatMap((e) => {
    if (e.entityKind !== 'MACHINE' || !e.resourceName) {
      return [];
    }
    const pts = e.cellIndices.map((i) => indexToRc(i, gridSize));
    const r = pts.reduce((s, p) => s + p.r, 0) / pts.length;
    const c = pts.reduce((s, p) => s + p.c, 0) / pts.length;
    return [{ resourceName: e.resourceName, r, c }];
  });
}

/** ドラフト内の既存 SHELF 採番を踏まえた次スロット */
export function resolveNextShelfSlot(baseNextShelfSlot: number, shelfPrefix: string, entities: DraftEntity[]): number {
  let slot = baseNextShelfSlot;
  for (const e of entities) {
    if (e.entityKind !== 'SHELF' || !e.shelfCodeRaw?.startsWith(`${shelfPrefix}-`)) {
      continue;
    }
    const tail = e.shelfCodeRaw.split('-').pop();
    const n = tail ? parseInt(tail, 10) : NaN;
    if (Number.isInteger(n) && n >= slot) {
      slot = n + 1;
    }
  }
  return slot;
}

export function previewShelfFields(input: {
  cellIndices: number[];
  gridSize: number;
  entities: DraftEntity[];
  shelfPrefix: string;
  baseNextShelfSlot: number;
  existingShelfCodeRaw: string | null;
  existingDisplayLabel: string | null;
}): { shelfCodeRaw: string; displayLabel: string; nextSlotAfter: number } {
  if (input.existingShelfCodeRaw) {
    const labels = input.entities
      .filter((e) => e.entityKind === 'SHELF' && e.displayLabel)
      .map((e) => e.displayLabel!);
    const machines = buildMachineAnchorsFromDraft(input.entities, input.gridSize);
    const displayLabel =
      input.existingDisplayLabel ??
      buildAutoDisplayLabel({
        cellIndices: input.cellIndices,
        gridSize: input.gridSize,
        machines,
        existingLabelsInZone: labels.filter((l) => l !== input.existingDisplayLabel)
      });
    return {
      shelfCodeRaw: input.existingShelfCodeRaw,
      displayLabel,
      nextSlotAfter: resolveNextShelfSlot(input.baseNextShelfSlot, input.shelfPrefix, input.entities)
    };
  }

  const slot = resolveNextShelfSlot(input.baseNextShelfSlot, input.shelfPrefix, input.entities);
  const allocated = allocateShelfCode(input.shelfPrefix, slot);
  const labels = input.entities
    .filter((e) => e.entityKind === 'SHELF' && e.displayLabel)
    .map((e) => e.displayLabel!);
  const machines = buildMachineAnchorsFromDraft(input.entities, input.gridSize);
  const displayLabel = buildAutoDisplayLabel({
    cellIndices: input.cellIndices,
    gridSize: input.gridSize,
    machines,
    existingLabelsInZone: labels
  });
  return {
    shelfCodeRaw: allocated.shelfCodeRaw,
    displayLabel,
    nextSlotAfter: allocated.nextShelfSlot
  };
}
