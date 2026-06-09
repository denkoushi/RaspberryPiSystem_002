import { describe, expect, it } from 'vitest';

import { resolveNextRequiredSelfInspectionEntryIndex } from '../resolveNextRequiredSelfInspectionEntryIndex';

import type { SelfInspectionSessionDetailDto } from '../types';

function sessionFixture(
  overrides: Partial<SelfInspectionSessionDetailDto> & {
    entries?: SelfInspectionSessionDetailDto['entries'];
  }
): SelfInspectionSessionDetailDto {
  return {
    id: 'session-1',
    templateId: 'tpl-1',
    productNo: 'P1',
    fseiban: 'S1',
    fhincd: 'FH1',
    fhinmei: '品名',
    resourceCd: 'R1',
    processGroup: 'cutting',
    scheduleRowId: 'row-1',
    selfInspectionMode: 'full',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    plannedQuantity: 3,
    expectedEntryCount: 3,
    requiredEntryCount: 3,
    completedEntryCount: 0,
    status: 'in_progress',
    completedAt: null,
    entryCountBlockedReason: null,
    template: {
      id: 'tpl-1',
      fhincd: 'FH1',
      resourceCd: 'R1',
      processGroup: 'cutting',
      name: 'テンプレ',
      version: 1,
      isActive: true,
      items: [],
      visualTemplateId: 'vt-1',
      visualTemplate: null
    },
    entries: [],
    ...overrides
  } as SelfInspectionSessionDetailDto;
}

describe('resolveNextRequiredSelfInspectionEntryIndex', () => {
  it('returns the next unsaved slot after current in full mode', () => {
    const session = sessionFixture({
      selfInspectionMode: 'full',
      plannedQuantity: 3,
      expectedEntryCount: 3,
      requiredEntryCount: 3,
      entries: [{ entryIndex: 0 } as SelfInspectionSessionDetailDto['entries'][number]]
    });
    expect(resolveNextRequiredSelfInspectionEntryIndex(session, 0)).toBe(1);
  });

  it('wraps to the first unsaved slot when none remain after current', () => {
    const session = sessionFixture({
      selfInspectionMode: 'full',
      plannedQuantity: 3,
      expectedEntryCount: 3,
      requiredEntryCount: 3,
      entries: [
        { entryIndex: 0 } as SelfInspectionSessionDetailDto['entries'][number],
        { entryIndex: 2 } as SelfInspectionSessionDetailDto['entries'][number]
      ]
    });
    expect(resolveNextRequiredSelfInspectionEntryIndex(session, 2)).toBe(1);
  });

  it('returns null when current entry is the last unsaved slot and already saved', () => {
    const session = sessionFixture({
      selfInspectionMode: 'full',
      plannedQuantity: 3,
      expectedEntryCount: 3,
      requiredEntryCount: 3,
      entries: [
        { entryIndex: 0 } as SelfInspectionSessionDetailDto['entries'][number],
        { entryIndex: 1 } as SelfInspectionSessionDetailDto['entries'][number],
        { entryIndex: 2 } as SelfInspectionSessionDetailDto['entries'][number]
      ]
    });
    expect(resolveNextRequiredSelfInspectionEntryIndex(session, 2)).toBeNull();
  });

  it('returns null when all required slots are saved', () => {
    const session = sessionFixture({
      selfInspectionMode: 'single',
      plannedQuantity: 1,
      expectedEntryCount: 1,
      requiredEntryCount: 1,
      entries: [{ entryIndex: 0 } as SelfInspectionSessionDetailDto['entries'][number]]
    });
    expect(resolveNextRequiredSelfInspectionEntryIndex(session, 0)).toBeNull();
  });

  it('uses first_last slot order', () => {
    const session = sessionFixture({
      selfInspectionMode: 'first_last',
      plannedQuantity: 5,
      expectedEntryCount: 2,
      requiredEntryCount: 2,
      entries: [{ entryIndex: 0 } as SelfInspectionSessionDetailDto['entries'][number]]
    });
    expect(resolveNextRequiredSelfInspectionEntryIndex(session, 0)).toBe(4);
    expect(
      resolveNextRequiredSelfInspectionEntryIndex(
        {
          ...session,
          entries: [
            { entryIndex: 0 } as SelfInspectionSessionDetailDto['entries'][number],
            { entryIndex: 4 } as SelfInspectionSessionDetailDto['entries'][number]
          ]
        },
        4
      )
    ).toBeNull();
  });

  it('supports fixed_count slots', () => {
    const session = sessionFixture({
      selfInspectionMode: 'fixed_count',
      plannedQuantity: 10,
      expectedEntryCount: 2,
      requiredEntryCount: 2,
      selfInspectionFixedCount: 2,
      entries: [{ entryIndex: 0 } as SelfInspectionSessionDetailDto['entries'][number]]
    });
    expect(resolveNextRequiredSelfInspectionEntryIndex(session, 0)).toBe(1);
  });
});
