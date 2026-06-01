import { describe, expect, it } from 'vitest';

import {
  areSelfInspectionEntryDraftsEqual,
  buildSelfInspectionEntryDraft,
  isSelfInspectionEntryDraftDirty,
  listDirtySelfInspectionEntryIndices,
  selfInspectionEntryIndicesForPage,
  selfInspectionEntryPageCount
} from '../selfInspectionEntryDraft';

import type { SelfInspectionSessionDetailDto } from '../types';

function sessionFixture(expectedEntryCount: number): SelfInspectionSessionDetailDto {
  return {
    id: 'session-1',
    sessionBusinessKey: 'k',
    templateId: 'tpl-1',
    templateName: 't',
    productNo: 'PN',
    fseiban: 'FS',
    fhincd: 'H',
    fhinmei: '名',
    processGroup: 'cutting',
    resourceCd: 'R',
    scheduleRowId: 'row-1',
    machineName: null,
    plannedQuantity: expectedEntryCount,
    expectedEntryCount,
    requiredEntryCount: expectedEntryCount,
    completedEntryCount: 0,
    selfInspectionMode: 'full',
    selfInspectionSampleSize: null,
    status: 'not_started',
    startedAt: null,
    completedAt: null,
    updatedAt: new Date().toISOString(),
    template: {
      id: 'tpl-1',
      name: 't',
      fhincd: 'H',
      processGroup: 'cutting',
      resourceCd: 'R',
      items: [
        {
          id: 'item-1',
          sortOrder: 0,
          datumSurface: 'A',
          measurementPoint: 'P',
          measurementLabel: 'L',
          displayMarker: '1',
          unit: null,
          allowNegative: false,
          decimalPlaces: 2,
          markerXRatio: 0.1,
          markerYRatio: 0.2,
          nominalValue: 10,
          lowerLimit: 9,
          upperLimit: 11
        }
      ],
      visualTemplate: null
    },
    entries: [
      {
        id: 'entry-0',
        entryIndex: 99,
        createdByEmployeeId: null,
        createdByEmployeeNameSnapshot: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        values: []
      }
    ],
    focusedEntry: {
      id: 'entry-0',
      entryIndex: 99,
      createdByEmployeeId: null,
      createdByEmployeeNameSnapshot: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      values: [{ id: 'v1', templateItemId: 'item-1', value: '10.01' }]
    }
  } as SelfInspectionSessionDetailDto;
}

describe('selfInspectionEntryDraft', () => {
  it('builds draft only for the requested entry index', () => {
    const session = sessionFixture(200);
    const draft = buildSelfInspectionEntryDraft(session, 99);
    expect(draft['item-1']).toBe('10.01');
    const empty = buildSelfInspectionEntryDraft(session, 0);
    expect(empty['item-1']).toBe('');
  });

  it('pages entry indices', () => {
    expect(selfInspectionEntryPageCount(100)).toBe(3);
    expect(selfInspectionEntryIndicesForPage(100, 0)).toEqual(
      Array.from({ length: 48 }, (_, i) => i)
    );
    expect(selfInspectionEntryIndicesForPage(100, 2)).toEqual([96, 97, 98, 99]);
  });

  it('detects dirty draft against saved snapshot', () => {
    const session = sessionFixture(200);
    const saved = buildSelfInspectionEntryDraft(session, 99);
    expect(isSelfInspectionEntryDraftDirty(session, 99, saved, saved)).toBe(false);
    expect(
      isSelfInspectionEntryDraftDirty(session, 99, { ...saved, 'item-1': '10.02' }, saved)
    ).toBe(true);
    expect(areSelfInspectionEntryDraftsEqual(saved, { ...saved, 'item-1': ' 10.01 ' }, ['item-1'])).toBe(true);
  });

  it('lists dirty entry indices across visited drafts', () => {
    const session = sessionFixture(200);
    const saved = buildSelfInspectionEntryDraft(session, 99);
    const dirty = listDirtySelfInspectionEntryIndices(
      session,
      {
        0: { 'item-1': '' },
        99: { ...saved, 'item-1': '11.00' }
      },
      {
        0: { 'item-1': '' },
        99: saved
      }
    );
    expect(dirty).toEqual([99]);
  });

  it('exposes entry index 49 on page 2 when required count is 49', () => {
    expect(selfInspectionEntryPageCount(49)).toBe(2);
    expect(selfInspectionEntryIndicesForPage(49, 0)).toEqual(
      Array.from({ length: 48 }, (_, index) => index)
    );
    expect(selfInspectionEntryIndicesForPage(49, 1)).toEqual([48]);
  });
});
