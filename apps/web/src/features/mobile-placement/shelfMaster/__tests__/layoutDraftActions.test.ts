import { describe, expect, it } from 'vitest';

import { applyLayoutAssignment, clearAssignmentsOnCells } from '../model/layoutDraftActions';

import type { DraftEntity } from '../model/shelfLayoutTypes';

describe('applyLayoutAssignment', () => {
  it('assigns SHELF with preview shelfCode and displayLabel', () => {
    const result = applyLayoutAssignment({
      draftEntities: [],
      selectedCells: [4],
      pendingKind: 'SHELF',
      machines: [],
      selectedMachineCd: '',
      gridSize: 3,
      shelfPrefix: '中央-中央',
      baseNextShelfSlot: 1
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shelf = result.entities.find((e) => e.entityKind === 'SHELF');
    expect(shelf?.shelfCodeRaw).toBe('中央-中央-01');
    expect(shelf?.displayLabel).toBeTruthy();
  });

  it('requires machine master for MACHINE', () => {
    const result = applyLayoutAssignment({
      draftEntities: [],
      selectedCells: [0],
      pendingKind: 'MACHINE',
      machines: [{ resourceCd: 'RD01', resourceName: 'Robodrill01' }],
      selectedMachineCd: '',
      gridSize: 3,
      shelfPrefix: '中央-中央',
      baseNextShelfSlot: 1
    });
    expect(result.ok).toBe(false);
  });

  it('keeps existing shelf code when reassigning an existing shelf cell', () => {
    const result = applyLayoutAssignment({
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
      machines: [],
      selectedMachineCd: '',
      gridSize: 3,
      shelfPrefix: '中央-中央',
      baseNextShelfSlot: 1
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shelf = result.entities.find((e) => e.entityKind === 'SHELF');
    expect(shelf?.shelfCodeRaw).toBe('中央-中央-07');
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
