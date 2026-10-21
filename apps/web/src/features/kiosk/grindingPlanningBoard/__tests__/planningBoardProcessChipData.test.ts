import { describe, expect, it } from 'vitest';

import { buildPlanningBoardProcessChipsByPart, collectPlanningBoardProcessChipParts } from '../planningBoardProcessChipData';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const item = (fseiban: string, productNo: string, fhincd = 'PART'): GrindingPlanningBoardItem => ({
  itemId: `${fseiban}-${productNo}-${fhincd}`, kind: 'row', itemRevision: 'rev', version: 1,
  sourceRowId: 'source', fseiban, productNo, fhincd, fhinmei: '部品', machineName: null,
  processOrder: '10', originalResourceCd: '305', effectiveResourceCd: null,
  originalDueDate: null, effectiveDueDate: null, originalRank: null, alternateRank: null,
  plannedQuantity: 1, requiredMinutes: 20, requiredMinutesKnown: true, isCompleted: false,
  progress: { completed: 0, total: 1, quantityKnown: false }
});
const completed = [{ rowId: 'row-1', resourceCd: '305', resourceNames: ['研削機'], isCompleted: true }];
const pending = [{ rowId: 'row-2', resourceCd: '306', isCompleted: false }];

describe('planning board process chip data', () => {
  it('requests only distinct normalized loaded triples in stable order', () => {
    const items = [item('B', '2'), item(' A ', ' 1 ', ' PART '), item('A', '1'), item('A', '2'), item('', '1'), item('A', '1', '')];
    const expected = [
      { fseiban: 'A', productNo: '1', fhincd: 'PART' },
      { fseiban: 'A', productNo: '2', fhincd: 'PART' },
      { fseiban: 'B', productNo: '2', fhincd: 'PART' }
    ];
    expect(collectPlanningBoardProcessChipParts(items)).toEqual(expected);
    expect(collectPlanningBoardProcessChipParts([...items].reverse())).toEqual(expected);
  });

  it('uses the first nonempty chips for a normal board part and deduplicates repeated rows', () => {
    const result = buildPlanningBoardProcessChipsByPart(
      [item('A', 'missing'), item('A', 'empty'), item(' A ', ' 1 '), item('A', '1'), item('A', '2'), item('B', '1')],
      { ['A\0empty\0PART']: [], ['A\0' + '1\0PART']: completed, ['A\0' + '2\0PART']: pending }
    );
    expect([...result]).toEqual([['A\0PART', completed]]);
    expect(result.get('A\0PART')).toBe(completed);
  });

  it('keeps unassigned seibans separate by productNo', () => {
    const result = buildPlanningBoardProcessChipsByPart(
      [item('********', '1'), item('********', '2'), item('********', '1')],
      { ['********\0' + '1\0PART']: completed, ['********\0' + '2\0PART']: pending }
    );
    expect([...result]).toEqual([['********\0PART\0' + '1', completed], ['********\0PART\0' + '2', pending]]);
  });

  it('handles missing data, empty boards and empty product numbers', () => {
    expect(buildPlanningBoardProcessChipsByPart([item('A', '1')], undefined).size).toBe(0);
    expect(buildPlanningBoardProcessChipsByPart([], { ['A\0\0PART']: completed }).size).toBe(0);
    expect(collectPlanningBoardProcessChipParts([])).toEqual([]);
    expect([...buildPlanningBoardProcessChipsByPart([item('A', '')], { ['A\0\0PART']: completed })]).toEqual([['A\0PART', completed]]);
  });
});
