import { describe, expect, it } from 'vitest';

import {
  buildSelfInspectionEntryRegistrationPayload,
  isSelfInspectionEntryRegistrationDirtyForSave,
  isSelfInspectionEntryRegistrationReadyForSave,
  isSelfInspectionSavedEntryRegistrationComplete,
  mergeSelfInspectionEntryRegistrationDraftWithSaved,
  hasUnsavedSelfInspectionRegistrationDraftWork,
  hasUnsavedSelfInspectionRegistrationDrafts,
  resolveSelfInspectionEntryRegistrationForDisplay
} from '../selfInspectionEntryRegistration';

describe('selfInspectionEntryRegistration', () => {
  it('requires both tags for a new entry', () => {
    expect(
      isSelfInspectionEntryRegistrationReadyForSave(
        {
          employeeTagUid: 'emp-tag',
          employeeDisplayName: 'Alice',
          measuringInstrumentTagUid: null,
          measuringInstrumentDisplayName: null
        },
        null
      )
    ).toBe(false);
  });

  it('accepts saved entry with persisted registration', () => {
    expect(
      isSelfInspectionEntryRegistrationReadyForSave(
        {
          employeeTagUid: null,
          employeeDisplayName: 'Alice',
          measuringInstrumentTagUid: null,
          measuringInstrumentDisplayName: 'MI-001 Caliper'
        },
        {
          createdByEmployeeId: 'emp-1',
          measuringInstrumentId: 'inst-1',
          createdByEmployeeNameSnapshot: 'Alice',
          measuringInstrumentNameSnapshot: 'Caliper',
          measuringInstrumentManagementNumberSnapshot: 'MI-001'
        }
      )
    ).toBe(true);
  });

  it('builds payload only for missing registration fields', () => {
    expect(
      buildSelfInspectionEntryRegistrationPayload(
        {
          employeeTagUid: 'emp-tag',
          employeeDisplayName: 'Alice',
          measuringInstrumentTagUid: 'inst-tag',
          measuringInstrumentDisplayName: 'MI-001 Caliper'
        },
        {
          createdByEmployeeId: 'emp-1',
          measuringInstrumentId: null
        }
      )
    ).toEqual({
      measuringInstrumentTagUid: 'inst-tag'
    });
  });

  it('detects registration-only dirty state for saved incomplete entries', () => {
    expect(
      isSelfInspectionEntryRegistrationDirtyForSave(
        {
          employeeTagUid: 'emp-tag',
          employeeDisplayName: 'Alice',
          measuringInstrumentTagUid: 'inst-tag',
          measuringInstrumentDisplayName: 'MI-001 Caliper'
        },
        {
          createdByEmployeeId: null,
          measuringInstrumentId: null,
          createdByEmployeeNameSnapshot: null,
          measuringInstrumentNameSnapshot: null,
          measuringInstrumentManagementNumberSnapshot: null
        }
      )
    ).toBe(true);
    expect(
      isSelfInspectionEntryRegistrationDirtyForSave(
        {
          employeeTagUid: 'emp-tag',
          employeeDisplayName: 'Alice',
          measuringInstrumentTagUid: 'inst-tag',
          measuringInstrumentDisplayName: 'MI-001 Caliper'
        },
        {
          createdByEmployeeId: 'emp-1',
          measuringInstrumentId: 'inst-1',
          createdByEmployeeNameSnapshot: 'Alice',
          measuringInstrumentNameSnapshot: 'Caliper',
          measuringInstrumentManagementNumberSnapshot: 'MI-001'
        }
      )
    ).toBe(false);
  });

  it('detects saved registration completeness', () => {
    expect(
      isSelfInspectionSavedEntryRegistrationComplete({
        createdByEmployeeId: 'emp-1',
        measuringInstrumentId: 'inst-1'
      })
    ).toBe(true);
    expect(
      isSelfInspectionSavedEntryRegistrationComplete({
        createdByEmployeeId: 'emp-1',
        measuringInstrumentId: null
      })
    ).toBe(false);
  });

  it('preserves in-progress NFC scans when session refetches', () => {
    const partialDraft = {
      employeeTagUid: 'emp-tag',
      employeeDisplayName: 'Alice',
      measuringInstrumentTagUid: null,
      measuringInstrumentDisplayName: null
    };
    const saved = {
      employeeTagUid: null,
      employeeDisplayName: null,
      measuringInstrumentTagUid: null,
      measuringInstrumentDisplayName: null
    };

    expect(
      mergeSelfInspectionEntryRegistrationDraftWithSaved(partialDraft, saved, {
        createdByEmployeeId: null,
        measuringInstrumentId: null
      })
    ).toEqual(partialDraft);
  });

  it('merges persisted registration from saved entry without dropping pending instrument scan', () => {
    const partialDraft = {
      employeeTagUid: null,
      employeeDisplayName: null,
      measuringInstrumentTagUid: 'inst-tag',
      measuringInstrumentDisplayName: 'MI-001 Caliper'
    };
    const saved = {
      employeeTagUid: null,
      employeeDisplayName: 'Alice',
      measuringInstrumentTagUid: null,
      measuringInstrumentDisplayName: null
    };

    expect(
      mergeSelfInspectionEntryRegistrationDraftWithSaved(partialDraft, saved, {
        createdByEmployeeId: 'emp-1',
        measuringInstrumentId: null
      })
    ).toEqual({
      employeeTagUid: null,
      employeeDisplayName: 'Alice',
      measuringInstrumentTagUid: 'inst-tag',
      measuringInstrumentDisplayName: 'MI-001 Caliper'
    });
  });

  it('shows saved employee when draft contains a stale wrong employee scan', () => {
    const savedEntry = {
      createdByEmployeeId: 'emp-1',
      createdByEmployeeNameSnapshot: 'Alice',
      measuringInstrumentId: null,
      measuringInstrumentNameSnapshot: null,
      measuringInstrumentManagementNumberSnapshot: null,
      measuringInstrumentTagUidSnapshot: null
    };
    const staleDraft = {
      employeeTagUid: 'wrong-tag',
      employeeDisplayName: 'Bob',
      measuringInstrumentTagUid: null,
      measuringInstrumentDisplayName: null
    };

    expect(resolveSelfInspectionEntryRegistrationForDisplay(staleDraft, savedEntry)).toEqual({
      employeeTagUid: null,
      employeeDisplayName: 'Alice',
      measuringInstrumentTagUid: null,
      measuringInstrumentDisplayName: null
    });
  });

  it('detects partial NFC scans as unsaved registration work', () => {
    expect(
      hasUnsavedSelfInspectionRegistrationDraftWork(
        {
          employeeTagUid: 'emp-tag',
          employeeDisplayName: 'Alice',
          measuringInstrumentTagUid: null,
          measuringInstrumentDisplayName: null
        },
        {
          createdByEmployeeId: null,
          measuringInstrumentId: null,
          createdByEmployeeNameSnapshot: null,
          measuringInstrumentNameSnapshot: null,
          measuringInstrumentManagementNumberSnapshot: null,
          measuringInstrumentTagUidSnapshot: null
        }
      )
    ).toBe(true);
  });

  it('detects unsaved registration drafts across session entries', () => {
    expect(
      hasUnsavedSelfInspectionRegistrationDrafts(
        {
          entries: [
            {
              entryIndex: 0,
              createdByEmployeeId: null,
              measuringInstrumentId: null,
              createdByEmployeeNameSnapshot: null,
              measuringInstrumentNameSnapshot: null,
              measuringInstrumentManagementNumberSnapshot: null,
              measuringInstrumentTagUidSnapshot: null
            }
          ]
        },
        {
          0: {
            employeeTagUid: 'emp-tag',
            employeeDisplayName: 'Alice',
            measuringInstrumentTagUid: null,
            measuringInstrumentDisplayName: null
          }
        }
      )
    ).toBe(true);
  });
});
