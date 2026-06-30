import type { SelfInspectionLotEntryDto, SelfInspectionSessionDetailDto } from './types';

export type SelfInspectionEntryRegistrationDraft = {
  employeeTagUid: string | null;
  employeeDisplayName: string | null;
  measuringInstrumentTagUid: string | null;
  measuringInstrumentDisplayName: string | null;
};

export type SelfInspectionRegistrationRequirementPolicy = {
  requireMeasuringInstrumentTag: boolean;
};

const DEFAULT_SELF_INSPECTION_REGISTRATION_REQUIREMENT: SelfInspectionRegistrationRequirementPolicy = {
  requireMeasuringInstrumentTag: true
};

export function formatMeasuringInstrumentDisplayLabel(entry: {
  measuringInstrumentManagementNumberSnapshot: string | null;
  measuringInstrumentNameSnapshot: string | null;
  instrumentUsages?: Array<{
    measuringInstrumentManagementNumberSnapshot: string;
    measuringInstrumentNameSnapshot: string;
  }>;
}): string | null {
  if (entry.instrumentUsages && entry.instrumentUsages.length > 0) {
    return entry.instrumentUsages
      .map((usage) => `${usage.measuringInstrumentManagementNumberSnapshot} ${usage.measuringInstrumentNameSnapshot}`)
      .join('、');
  }
  if (entry.measuringInstrumentNameSnapshot && entry.measuringInstrumentManagementNumberSnapshot) {
    return `${entry.measuringInstrumentManagementNumberSnapshot} ${entry.measuringInstrumentNameSnapshot}`;
  }
  return entry.measuringInstrumentNameSnapshot;
}

export function hasSelfInspectionEntryInstrumentUsage(
  entry: Pick<SelfInspectionLotEntryDto, 'measuringInstrumentId'> & {
    instrumentUsages?: SelfInspectionLotEntryDto['instrumentUsages'];
  } | null | undefined
): boolean {
  return Boolean((entry?.instrumentUsages?.length ?? 0) > 0 || entry?.measuringInstrumentId);
}

export function resolveSelfInspectionEntryRegistrationFromSaved(
  entry: Pick<
    SelfInspectionLotEntryDto,
    | 'createdByEmployeeId'
    | 'createdByEmployeeNameSnapshot'
    | 'measuringInstrumentId'
    | 'measuringInstrumentNameSnapshot'
    | 'measuringInstrumentManagementNumberSnapshot'
    | 'measuringInstrumentTagUidSnapshot'
    | 'instrumentUsages'
  > | null | undefined
): SelfInspectionEntryRegistrationDraft {
  if (!entry) {
    return {
      employeeTagUid: null,
      employeeDisplayName: null,
      measuringInstrumentTagUid: null,
      measuringInstrumentDisplayName: null
    };
  }
  return {
    employeeTagUid: null,
    employeeDisplayName: entry.createdByEmployeeNameSnapshot,
    measuringInstrumentTagUid: entry.measuringInstrumentTagUidSnapshot,
    measuringInstrumentDisplayName: formatMeasuringInstrumentDisplayLabel(entry)
  };
}

/** session refetch 時に、未保存の NFC スキャン結果を saved 側で潰さない */
export function mergeSelfInspectionEntryRegistrationDraftWithSaved(
  draft: SelfInspectionEntryRegistrationDraft,
  saved: SelfInspectionEntryRegistrationDraft,
  savedEntry: Pick<SelfInspectionLotEntryDto, 'createdByEmployeeId' | 'measuringInstrumentId'> | null | undefined
): SelfInspectionEntryRegistrationDraft {
  const employeePersisted = Boolean(savedEntry?.createdByEmployeeId);
  const instrumentPersisted = hasSelfInspectionEntryInstrumentUsage(savedEntry);

  return {
    employeeTagUid: employeePersisted
      ? saved.employeeTagUid
      : (draft.employeeTagUid ?? saved.employeeTagUid),
    employeeDisplayName: employeePersisted
      ? saved.employeeDisplayName
      : (draft.employeeDisplayName ?? saved.employeeDisplayName),
    measuringInstrumentTagUid: instrumentPersisted
      ? saved.measuringInstrumentTagUid
      : (draft.measuringInstrumentTagUid ?? saved.measuringInstrumentTagUid),
    measuringInstrumentDisplayName: instrumentPersisted
      ? saved.measuringInstrumentDisplayName
      : (draft.measuringInstrumentDisplayName ?? saved.measuringInstrumentDisplayName)
  };
}

export function resolveSelfInspectionEntryRegistrationForDisplay(
  draftFromState: SelfInspectionEntryRegistrationDraft | undefined,
  savedEntry: Pick<
    SelfInspectionLotEntryDto,
    | 'createdByEmployeeId'
    | 'createdByEmployeeNameSnapshot'
    | 'measuringInstrumentId'
    | 'measuringInstrumentNameSnapshot'
    | 'measuringInstrumentManagementNumberSnapshot'
    | 'measuringInstrumentTagUidSnapshot'
    | 'instrumentUsages'
  > | null | undefined
): SelfInspectionEntryRegistrationDraft {
  const savedRegistration = resolveSelfInspectionEntryRegistrationFromSaved(savedEntry);
  if (draftFromState === undefined) {
    return savedRegistration;
  }
  return mergeSelfInspectionEntryRegistrationDraftWithSaved(
    draftFromState,
    savedRegistration,
    savedEntry
  );
}

export function isSelfInspectionEntryRegistrationReadyForSave(
  registration: SelfInspectionEntryRegistrationDraft,
  savedEntry: Pick<SelfInspectionLotEntryDto, 'createdByEmployeeId' | 'measuringInstrumentId' | 'createdByEmployeeNameSnapshot' | 'measuringInstrumentNameSnapshot' | 'measuringInstrumentManagementNumberSnapshot'> & {
    instrumentUsages?: SelfInspectionLotEntryDto['instrumentUsages'];
  } | null | undefined,
  policy: SelfInspectionRegistrationRequirementPolicy = DEFAULT_SELF_INSPECTION_REGISTRATION_REQUIREMENT
): boolean {
  if (isSelfInspectionSavedEntryRegistrationComplete(savedEntry, policy)) {
    return true;
  }
  const hasEmployee = Boolean(
    savedEntry?.createdByEmployeeId ||
      (registration.employeeTagUid && registration.employeeDisplayName)
  );
  const hasInstrument = Boolean(
    hasSelfInspectionEntryInstrumentUsage(savedEntry) ||
      (registration.measuringInstrumentTagUid && registration.measuringInstrumentDisplayName)
  );
  return hasEmployee && (!policy.requireMeasuringInstrumentTag || hasInstrument);
}

export function buildSelfInspectionEntryRegistrationPayload(
  registration: SelfInspectionEntryRegistrationDraft,
  savedEntry: Pick<SelfInspectionLotEntryDto, 'createdByEmployeeId' | 'measuringInstrumentId'> & {
    instrumentUsages?: SelfInspectionLotEntryDto['instrumentUsages'];
  } | null | undefined
): { employeeTagUid?: string | null; measuringInstrumentTagUid?: string | null } {
  const payload: { employeeTagUid?: string | null; measuringInstrumentTagUid?: string | null } = {};
  if (!savedEntry?.createdByEmployeeId && registration.employeeTagUid) {
    payload.employeeTagUid = registration.employeeTagUid;
  }
  if (!hasSelfInspectionEntryInstrumentUsage(savedEntry) && registration.measuringInstrumentTagUid) {
    payload.measuringInstrumentTagUid = registration.measuringInstrumentTagUid;
  }
  return payload;
}

export function isSelfInspectionEntryRegistrationReady(
  registration: SelfInspectionEntryRegistrationDraft,
  policy: SelfInspectionRegistrationRequirementPolicy = DEFAULT_SELF_INSPECTION_REGISTRATION_REQUIREMENT
): boolean {
  const hasEmployee = Boolean(registration.employeeTagUid && registration.employeeDisplayName);
  const hasInstrument = Boolean(registration.measuringInstrumentTagUid && registration.measuringInstrumentDisplayName);
  return hasEmployee && (!policy.requireMeasuringInstrumentTag || hasInstrument);
}

export function isSelfInspectionSavedEntryRegistrationComplete(
  entry: Pick<SelfInspectionLotEntryDto, 'createdByEmployeeId' | 'measuringInstrumentId'> & {
    instrumentUsages?: SelfInspectionLotEntryDto['instrumentUsages'];
  } | null | undefined,
  policy: SelfInspectionRegistrationRequirementPolicy = DEFAULT_SELF_INSPECTION_REGISTRATION_REQUIREMENT
): boolean {
  return Boolean(
    entry?.createdByEmployeeId && (!policy.requireMeasuringInstrumentTag || hasSelfInspectionEntryInstrumentUsage(entry))
  );
}

/** 測定値は保存済みだが NFC 登録だけ未反映の entry を保存可能にする */
export function isSelfInspectionEntryRegistrationDirtyForSave(
  registration: SelfInspectionEntryRegistrationDraft,
  savedEntry: Pick<
    SelfInspectionLotEntryDto,
    | 'createdByEmployeeId'
    | 'measuringInstrumentId'
    | 'createdByEmployeeNameSnapshot'
    | 'measuringInstrumentNameSnapshot'
    | 'measuringInstrumentManagementNumberSnapshot'
    | 'instrumentUsages'
  > | null | undefined,
  policy: SelfInspectionRegistrationRequirementPolicy = DEFAULT_SELF_INSPECTION_REGISTRATION_REQUIREMENT
): boolean {
  const hasPendingEmployee = Boolean(
    !savedEntry?.createdByEmployeeId &&
      registration.employeeTagUid &&
      registration.employeeDisplayName
  );
  const hasPendingInstrument = Boolean(
    !hasSelfInspectionEntryInstrumentUsage(savedEntry) &&
      registration.measuringInstrumentTagUid &&
      registration.measuringInstrumentDisplayName
  );
  if (hasPendingEmployee || hasPendingInstrument) {
    return isSelfInspectionEntryRegistrationReadyForSave(registration, savedEntry, policy);
  }
  return false;
}

/** 未保存の NFC スキャン（部分スキャン含む）があるか */
export function hasUnsavedSelfInspectionRegistrationDraftWork(
  draftFromState: SelfInspectionEntryRegistrationDraft,
  savedEntry: Pick<
    SelfInspectionLotEntryDto,
    | 'createdByEmployeeId'
    | 'measuringInstrumentId'
    | 'createdByEmployeeNameSnapshot'
    | 'measuringInstrumentNameSnapshot'
    | 'measuringInstrumentManagementNumberSnapshot'
    | 'measuringInstrumentTagUidSnapshot'
    | 'instrumentUsages'
  > | null | undefined,
  policy: SelfInspectionRegistrationRequirementPolicy = DEFAULT_SELF_INSPECTION_REGISTRATION_REQUIREMENT
): boolean {
  const displayed = resolveSelfInspectionEntryRegistrationForDisplay(draftFromState, savedEntry);
  if (isSelfInspectionEntryRegistrationDirtyForSave(displayed, savedEntry, policy)) {
    return true;
  }
  if (!savedEntry?.createdByEmployeeId && draftFromState.employeeTagUid) {
    return true;
  }
  if (!hasSelfInspectionEntryInstrumentUsage(savedEntry) && draftFromState.measuringInstrumentTagUid) {
    return true;
  }
  return false;
}

export function hasUnsavedSelfInspectionRegistrationDrafts(
  session: Pick<SelfInspectionSessionDetailDto, 'entries'>,
  draftByEntryIndex: Record<number, SelfInspectionEntryRegistrationDraft>,
  policy: SelfInspectionRegistrationRequirementPolicy = DEFAULT_SELF_INSPECTION_REGISTRATION_REQUIREMENT
): boolean {
  return Object.keys(draftByEntryIndex).some((indexKey) => {
    const entryIndex = Number(indexKey);
    const savedEntry = session.entries.find((entry) => entry.entryIndex === entryIndex) ?? null;
    return hasUnsavedSelfInspectionRegistrationDraftWork(
      draftByEntryIndex[entryIndex],
      savedEntry,
      policy
    );
  });
}
