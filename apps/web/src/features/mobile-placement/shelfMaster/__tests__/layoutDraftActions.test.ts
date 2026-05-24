import { describe, expect, it } from 'vitest';

import { applyLayoutAssignment, clearAssignmentsOnCells } from '../model/layoutDraftActions';
import { buildRenderItems } from '../model/shelfLayoutGrid';

import type { DraftEntity } from '../model/shelfLayoutTypes';

const machines = [{ resourceCd: 'RD01', resourceName: 'Robodrill01' }];

const baseInput = {
  machines,
  selectedMachineCd: 'RD01',
  gridSize: 3 as const,
  shelfPrefix: '中央-中央',
  baseNextShelfSlot: 1
};

describe('applyLayoutAssignment', () => {
  it('assigns SHELF with preview shelfCode and displayLabel', () => {
    const result = applyLayoutAssignment({
      ...baseInput,
      draftEntities: [],
      selectedCells: [4],
      pendingKind: 'SHELF',
      selectedMachineCd: ''
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shelf = result.entities.find((e) => e.entityKind === 'SHELF');
    expect(shelf?.shelfCodeRaw).toBe('中央-中央-01');
    expect(shelf?.displayLabel).toBeTruthy();
  });

  it('requires machine master for MACHINE', () => {
    const result = applyLayoutAssignment({
      ...baseInput,
      draftEntities: [],
      selectedCells: [0],
      pendingKind: 'MACHINE',
      selectedMachineCd: ''
    });
    expect(result.ok).toBe(false);
  });

  it('keeps existing shelf code when reassigning an existing shelf cell', () => {
    const result = applyLayoutAssignment({
      ...baseInput,
      draftEntities: [
        {
          entityKind: 'SHELF',
          cellIndices: [4],
          resourceCd: null,
          resourceName: null,
          shelfCodeRaw: '中央-中央-07',
          displayLabel: '置場07',
          aisleLabel: null
        }
      ],
      selectedCells: [4],
      pendingKind: 'SHELF',
      selectedMachineCd: ''
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shelf = result.entities.find((e) => e.entityKind === 'SHELF');
    expect(shelf?.shelfCodeRaw).toBe('中央-中央-07');
  });

  it('assigns merged AISLE entity for multiple cells', () => {
    const result = applyLayoutAssignment({
      ...baseInput,
      draftEntities: [],
      selectedCells: [0, 1],
      pendingKind: 'AISLE',
      selectedMachineCd: ''
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const aisles = result.entities.filter((e) => e.entityKind === 'AISLE');
    expect(aisles).toHaveLength(1);
    expect(aisles[0]?.cellIndices).toEqual([0, 1]);
  });

  it('releases merged MACHINE to empty cells via UNUSED (no entities)', () => {
    const assignMachine = applyLayoutAssignment({
      ...baseInput,
      draftEntities: [],
      selectedCells: [0, 1, 3],
      pendingKind: 'MACHINE'
    });
    expect(assignMachine.ok).toBe(true);
    if (!assignMachine.ok) return;

    const release = applyLayoutAssignment({
      ...baseInput,
      draftEntities: assignMachine.entities,
      selectedCells: [0, 1, 3],
      pendingKind: 'UNUSED',
      selectedMachineCd: ''
    });
    expect(release.ok).toBe(true);
    if (!release.ok) return;
    expect(release.entities).toHaveLength(0);

    const items = buildRenderItems(release.entities, 3);
    for (const index of [0, 1, 3]) {
      const item = items.find((i) => i.cells.length === 1 && i.cells[0] === index);
      expect(item?.entity).toBeNull();
    }
    const mergedEmpty = items.filter(
      (item) => item.entity == null && item.cells.length > 1
    );
    expect(mergedEmpty).toHaveLength(0);
  });

  it('partially releases merged MACHINE when only subset selected for UNUSED', () => {
    const assignMachine = applyLayoutAssignment({
      ...baseInput,
      draftEntities: [],
      selectedCells: [0, 1, 3],
      pendingKind: 'MACHINE'
    });
    expect(assignMachine.ok).toBe(true);
    if (!assignMachine.ok) return;

    const release = applyLayoutAssignment({
      ...baseInput,
      draftEntities: assignMachine.entities,
      selectedCells: [0, 1],
      pendingKind: 'UNUSED',
      selectedMachineCd: ''
    });
    expect(release.ok).toBe(true);
    if (!release.ok) return;
    const machine = release.entities.find((e) => e.entityKind === 'MACHINE');
    expect(machine?.cellIndices).toEqual([3]);
  });

  it('releases merged SHELF via UNUSED', () => {
    const assignShelf = applyLayoutAssignment({
      ...baseInput,
      draftEntities: [],
      selectedCells: [0, 1, 2],
      pendingKind: 'SHELF',
      selectedMachineCd: ''
    });
    expect(assignShelf.ok).toBe(true);
    if (!assignShelf.ok) return;

    const release = applyLayoutAssignment({
      ...baseInput,
      draftEntities: assignShelf.entities,
      selectedCells: [0, 1, 2],
      pendingKind: 'UNUSED',
      selectedMachineCd: ''
    });
    expect(release.ok).toBe(true);
    if (!release.ok) return;
    expect(release.entities).toHaveLength(0);
  });
});

describe('clearAssignmentsOnCells', () => {
  it('removes selected cells from entities', () => {
    const entities: DraftEntity[] = [
      {
        entityKind: 'SHELF',
        cellIndices: [4],
        resourceCd: null,
        resourceName: null,
        shelfCodeRaw: '中央-中央-01',
        displayLabel: 'A',
        aisleLabel: null
      }
    ];
    const next = clearAssignmentsOnCells(entities, [4]);
    expect(next).toHaveLength(0);
  });

  it('removes merged multi-cell entity when all indices are selected', () => {
    const entities: DraftEntity[] = [
      {
        entityKind: 'SHELF',
        cellIndices: [0, 1, 2],
        resourceCd: null,
        resourceName: null,
        shelfCodeRaw: '中央-中央-01',
        displayLabel: 'A',
        aisleLabel: null
      }
    ];
    const next = clearAssignmentsOnCells(entities, [0, 1, 2]);
    expect(next).toHaveLength(0);
  });
});
