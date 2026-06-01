import { describe, expect, it } from 'vitest';

import { applySelfInspectionEntrySaveToSessionCache } from '../mergeSelfInspectionSessionAfterEntrySave';

import type { SelfInspectionSessionDetailDto } from '../types';

function sessionFixture(entryIndices: number[]): SelfInspectionSessionDetailDto {
  return {
    id: 's1',
    sessionBusinessKey: 'k',
    templateId: 't1',
    templateName: 'T',
    productNo: 'PN',
    fseiban: 'FS',
    fhincd: 'H',
    fhinmei: '品',
    processGroup: 'cutting',
    resourceCd: '581',
    scheduleRowId: 'row-1',
    machineName: null,
    plannedQuantity: 2,
    expectedEntryCount: 2,
    requiredEntryCount: 2,
    completedEntryCount: entryIndices.length,
    selfInspectionMode: 'sample',
    selfInspectionSampleSize: 2,
    status: 'in_progress',
    startedAt: null,
    completedAt: null,
    updatedAt: '2026-06-01T00:00:00.000Z',
    template: {
      id: 't1',
      name: 'T',
      fhincd: 'H',
      processGroup: 'cutting',
      resourceCd: '581',
      templateScope: 'three_key',
      isActive: true,
      selfInspectionMode: 'sample',
      selfInspectionSampleSize: 2,
      items: [],
      visualTemplate: null
    },
    entries: entryIndices.map((entryIndex) => ({
      id: `e-${entryIndex}`,
      entryIndex,
      createdByEmployeeId: null,
      createdByEmployeeNameSnapshot: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
      values: []
    })),
    focusedEntry: null
  };
}

const savedEntry = {
  id: 'e-1',
  entryIndex: 1,
  createdByEmployeeId: null,
  createdByEmployeeNameSnapshot: null,
  createdAt: '2026-06-01T00:00:01.000Z',
  updatedAt: '2026-06-01T00:00:01.000Z',
  values: [{ id: 'v1', templateItemId: 'i1', value: '10' }]
};

describe('applySelfInspectionEntrySaveToSessionCache', () => {
  it('updates completedEntryCount on every entryIndex cache when a new index is saved', () => {
    const entry0Cache = sessionFixture([0]);
    const updated = applySelfInspectionEntrySaveToSessionCache(entry0Cache, savedEntry, 0);
    expect(updated?.completedEntryCount).toBe(2);
    expect(updated?.entries.map((row) => row.entryIndex)).toEqual([0, 1]);
    expect(updated?.focusedEntry).toBeNull();
  });

  it('sets focusedEntry only on the cache for the saved entryIndex', () => {
    const entry1Cache = sessionFixture([0, 1]);
    const updated = applySelfInspectionEntrySaveToSessionCache(entry1Cache, savedEntry, 1);
    expect(updated?.focusedEntry?.entryIndex).toBe(1);
  });
});
