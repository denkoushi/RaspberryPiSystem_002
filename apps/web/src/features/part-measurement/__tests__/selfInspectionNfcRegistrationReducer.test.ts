import { describe, expect, it } from 'vitest';

import {
  INITIAL_NFC_REGISTRATION_STATE,
  reduceSelfInspectionNfcRegistrationState
} from '../useSelfInspectionNfcRegistration';

const emptySaved = {
  employeeTagUid: null,
  employeeDisplayName: null,
  measuringInstrumentTagUid: null,
  measuringInstrumentDisplayName: null
};

const savedEntryWithEmployee = {
  createdByEmployeeId: 'emp-1',
  measuringInstrumentId: null,
  instrumentUsages: [],
  createdByEmployeeNameSnapshot: 'Alice',
  measuringInstrumentNameSnapshot: null,
  measuringInstrumentManagementNumberSnapshot: null
};

const savedRegistrationWithEmployee = {
  employeeTagUid: null,
  employeeDisplayName: 'Alice',
  measuringInstrumentTagUid: null,
  measuringInstrumentDisplayName: null
};

describe('reduceSelfInspectionNfcRegistrationState', () => {
  it('updates draft and clears error on successful resolve', () => {
    const next = reduceSelfInspectionNfcRegistrationState(
      { ...INITIAL_NFC_REGISTRATION_STATE, errorStatus: 'resolving' },
      {
        type: 'resolve_result',
        entryIndex: 0,
        savedRegistration: emptySaved,
        savedEntry: null,
        result: {
          kind: 'employee',
          employee: { nfcTagUid: 'emp-tag', displayName: 'Alice' }
        }
      }
    );

    expect(next.errorStatus).toBeNull();
    expect(next.message).toBeNull();
    expect(next.draftByEntryIndex[0]).toEqual({
      employeeTagUid: 'emp-tag',
      employeeDisplayName: 'Alice',
      measuringInstrumentTagUid: null,
      measuringInstrumentDisplayName: null
    });
  });

  it('keeps draft and sets error on failed resolve', () => {
    const next = reduceSelfInspectionNfcRegistrationState(
      { ...INITIAL_NFC_REGISTRATION_STATE, errorStatus: 'resolving' },
      {
        type: 'resolve_result',
        entryIndex: 0,
        savedRegistration: emptySaved,
        savedEntry: null,
        result: { kind: 'unknown' }
      }
    );

    expect(next.errorStatus).toBe('unknown');
    expect(next.message).toBe('未登録のNFCタグです。');
    expect(next.draftByEntryIndex[0]).toBeUndefined();
  });

  it('merges consecutive resolves for the same entry', () => {
    const afterEmployee = reduceSelfInspectionNfcRegistrationState(
      INITIAL_NFC_REGISTRATION_STATE,
      {
        type: 'resolve_result',
        entryIndex: 0,
        savedRegistration: emptySaved,
        savedEntry: null,
        result: {
          kind: 'employee',
          employee: { nfcTagUid: 'emp-tag', displayName: 'Alice' }
        }
      }
    );

    const afterInstrument = reduceSelfInspectionNfcRegistrationState(afterEmployee, {
      type: 'resolve_result',
      entryIndex: 0,
      savedRegistration: emptySaved,
      savedEntry: null,
      result: {
        kind: 'instrument',
        instrument: {
          tagUid: 'inst-tag',
          managementNumber: 'MI-001',
          name: 'Caliper'
        }
      }
    });

    expect(afterInstrument.draftByEntryIndex[0]).toEqual({
      employeeTagUid: 'emp-tag',
      employeeDisplayName: 'Alice',
      measuringInstrumentTagUid: 'inst-tag',
      measuringInstrumentDisplayName: 'MI-001 Caliper'
    });
  });

  it('rejects employee scan when employee is already persisted on the entry', () => {
    const next = reduceSelfInspectionNfcRegistrationState(INITIAL_NFC_REGISTRATION_STATE, {
      type: 'resolve_result',
      entryIndex: 0,
      savedRegistration: savedRegistrationWithEmployee,
      savedEntry: savedEntryWithEmployee,
      result: {
        kind: 'employee',
        employee: { nfcTagUid: 'wrong-tag', displayName: 'Bob' }
      }
    });

    expect(next.errorStatus).toBe('error');
    expect(next.message).toBe('測定者は既に登録済みです。別の社員タグは不要です。');
    expect(next.draftByEntryIndex[0]).toBeUndefined();
  });

  it('clears all drafts when session context resets', () => {
    const withDraft = reduceSelfInspectionNfcRegistrationState(INITIAL_NFC_REGISTRATION_STATE, {
      type: 'resolve_result',
      entryIndex: 0,
      savedRegistration: emptySaved,
      savedEntry: null,
      result: {
        kind: 'employee',
        employee: { nfcTagUid: 'emp-tag', displayName: 'Alice' }
      }
    });

    expect(reduceSelfInspectionNfcRegistrationState(withDraft, { type: 'reset_context', clearDrafts: true }))
      .toEqual(INITIAL_NFC_REGISTRATION_STATE);
  });

  it('keeps drafts when only entry context resets', () => {
    const withDraft = reduceSelfInspectionNfcRegistrationState(INITIAL_NFC_REGISTRATION_STATE, {
      type: 'resolve_result',
      entryIndex: 0,
      savedRegistration: emptySaved,
      savedEntry: null,
      result: {
        kind: 'employee',
        employee: { nfcTagUid: 'emp-tag', displayName: 'Alice' }
      }
    });

    const next = reduceSelfInspectionNfcRegistrationState(withDraft, { type: 'reset_context' });
    expect(next.draftByEntryIndex[0]).toEqual(withDraft.draftByEntryIndex[0]);
    expect(next.errorStatus).toBeNull();
  });
});
