import { describe, expect, it } from 'vitest';

import { collapseNonconformitiesForDisplay } from './selfInspectionNonconformityDisplay';

import type { SelfInspectionNonconformity } from '../../api/domains/self-inspection-nonconformities';

function makeItem(
  overrides: Partial<SelfInspectionNonconformity> = {}
): SelfInspectionNonconformity {
  return {
    id: 'case-1',
    discoveredOn: '2026-03-31',
    originDepartmentName: '資材課',
    remarks: '同じ備考',
    nonconformityContent: '同じ不適合内容',
    dispositionContent: '同じ処置内容',
    correctiveContent1: null,
    correctiveContent2: '同じ是正内容',
    partName: 'Ｘベース',
    machineName: '機種A',
    ...overrides
  };
}

describe('collapseNonconformitiesForDisplay', () => {
  it('collapses rows that differ only by source identity', () => {
    const first = makeItem();
    const second = makeItem({ id: 'case-2' });

    expect(collapseNonconformitiesForDisplay([first, second])).toEqual([first]);
  });

  it('treats values rendered the same as the same display content', () => {
    const first = makeItem({ correctiveContent1: null, remarks: '同じ備考\n' });
    const second = makeItem({
      id: 'case-2',
      correctiveContent1: '',
      remarks: '  同じ備考\r\n'
    });

    expect(collapseNonconformitiesForDisplay([first, second])).toEqual([first]);
  });

  it.each([
    ['discoveredOn', '2026-03-16'],
    ['originDepartmentName', '設計課'],
    ['remarks', '別の備考'],
    ['nonconformityContent', '別の不適合内容'],
    ['dispositionContent', '別の処置内容'],
    ['correctiveContent1', '別の是正内容1'],
    ['correctiveContent2', '別の是正内容2'],
    ['partName', '別の部品'],
    ['machineName', '別の機種']
  ] as const)('keeps a separate item when %s differs', (field, value) => {
    const first = makeItem();
    const second = makeItem({ id: 'case-2', [field]: value });

    expect(collapseNonconformitiesForDisplay([first, second])).toEqual([first, second]);
  });

  it('does not mutate the source array', () => {
    const items = [makeItem(), makeItem({ id: 'case-2' })];

    collapseNonconformitiesForDisplay(items);

    expect(items).toHaveLength(2);
  });
});
