import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { resolveSelfInspectionNfcTagUid, type SelfInspectionNfcTagResolveResult } from '../../api/client';

import {
  buildSelfInspectionEntryRegistrationPayload,
  hasSelfInspectionEntryInstrumentUsage,
  hasUnsavedSelfInspectionRegistrationDrafts,
  isSelfInspectionEntryRegistrationDirtyForSave,
  isSelfInspectionEntryRegistrationReady,
  isSelfInspectionEntryRegistrationReadyForSave,
  mergeSelfInspectionEntryRegistrationDraftWithSaved,
  resolveSelfInspectionEntryRegistrationForDisplay,
  resolveSelfInspectionEntryRegistrationFromSaved,
  type SelfInspectionEntryRegistrationDraft,
  type SelfInspectionRegistrationRequirementPolicy
} from './selfInspectionEntryRegistration';

import type { SelfInspectionLotEntryDto, SelfInspectionSessionDetailDto } from './types';
import type { NfcEvent } from '../../hooks/useNfcStream';

export type SelfInspectionNfcRegistrationStatus =
  | 'idle'
  | 'resolving'
  | 'employeeResolved'
  | 'instrumentResolved'
  | 'ready'
  | 'unknown'
  | 'duplicate'
  | 'error';

export type SelfInspectionNfcRegistrationView = SelfInspectionEntryRegistrationDraft & {
  status: SelfInspectionNfcRegistrationStatus;
  message: string | null;
  isReady: boolean;
  isLocked: boolean;
  nextActionLabel: string | null;
};

type SavedEntryRegistrationContext = Pick<
  SelfInspectionLotEntryDto,
  | 'createdByEmployeeId'
  | 'measuringInstrumentId'
  | 'instrumentUsages'
  | 'createdByEmployeeNameSnapshot'
  | 'measuringInstrumentNameSnapshot'
  | 'measuringInstrumentManagementNumberSnapshot'
> | null;

type ResolveDraftOutcome =
  | { type: 'success'; draft: SelfInspectionEntryRegistrationDraft }
  | { type: 'error'; errorStatus: SelfInspectionNfcRegistrationStatus; message: string };

const EMPTY_DRAFT: SelfInspectionEntryRegistrationDraft = {
  employeeTagUid: null,
  employeeDisplayName: null,
  measuringInstrumentTagUid: null,
  measuringInstrumentDisplayName: null
};

function instrumentLabelFromResolve(instrument: {
  managementNumber: string;
  name: string;
}): string {
  return `${instrument.managementNumber} ${instrument.name}`;
}

function deriveStatus(
  draft: SelfInspectionEntryRegistrationDraft,
  errorStatus: SelfInspectionNfcRegistrationStatus | null,
  policy: SelfInspectionRegistrationRequirementPolicy
): SelfInspectionNfcRegistrationStatus {
  if (errorStatus && errorStatus !== 'idle') {
    return errorStatus;
  }
  if (isSelfInspectionEntryRegistrationReady(draft, policy)) {
    return 'ready';
  }
  if (draft.measuringInstrumentTagUid && !draft.employeeTagUid) {
    return 'instrumentResolved';
  }
  if (draft.employeeTagUid && !draft.measuringInstrumentTagUid) {
    return 'employeeResolved';
  }
  return 'idle';
}

function nextActionLabelForDraft(
  draft: SelfInspectionEntryRegistrationDraft,
  savedEntry: SavedEntryRegistrationContext,
  policy: SelfInspectionRegistrationRequirementPolicy
): string | null {
  if (isSelfInspectionEntryRegistrationReadyForSave(draft, savedEntry, policy)) {
    return null;
  }
  const needsInstrument =
    policy.requireMeasuringInstrumentTag &&
    !hasSelfInspectionEntryInstrumentUsage(savedEntry) &&
    !draft.measuringInstrumentTagUid;
  const needsEmployee = !savedEntry?.createdByEmployeeId && !draft.employeeTagUid;
  if (needsInstrument) {
    return '計測機器タグをスキャン';
  }
  if (needsEmployee) {
    return '社員タグをスキャン';
  }
  return null;
}

function mergeResolveResultIntoDraft(
  current: SelfInspectionEntryRegistrationDraft,
  result: SelfInspectionNfcTagResolveResult,
  savedEntry: SavedEntryRegistrationContext
): ResolveDraftOutcome {
  if (result.kind === 'unknown') {
    return { type: 'error', errorStatus: 'unknown', message: '未登録のNFCタグです。' };
  }
  if (result.kind === 'duplicate') {
    return {
      type: 'error',
      errorStatus: 'duplicate',
      message: '同一タグが社員と計測機器の両方に登録されています。管理データを修正してください。'
    };
  }
  if (result.kind === 'instrument_unavailable') {
    return {
      type: 'error',
      errorStatus: 'error',
      message: '廃棄済みの計測機器は自主検査に使用できません。'
    };
  }

  const next = { ...current };

  if (result.kind === 'employee') {
    if (savedEntry?.createdByEmployeeId) {
      return {
        type: 'error',
        errorStatus: 'error',
        message: '測定者は既に登録済みです。別の社員タグは不要です。'
      };
    }
    if (next.measuringInstrumentTagUid === result.employee.nfcTagUid) {
      return { type: 'error', errorStatus: 'duplicate', message: '計測機器と同じタグです。' };
    }
    if (next.employeeTagUid && next.employeeTagUid !== result.employee.nfcTagUid) {
      return {
        type: 'error',
        errorStatus: 'error',
        message: '測定者は既に登録済みです。差し替えはできません。'
      };
    }
    next.employeeTagUid = result.employee.nfcTagUid;
    next.employeeDisplayName = result.employee.displayName;
  }

  if (result.kind === 'instrument') {
    if (hasSelfInspectionEntryInstrumentUsage(savedEntry)) {
      return {
        type: 'error',
        errorStatus: 'error',
        message: 'この入力件では使用前点検済みです。'
      };
    }
    if (next.employeeTagUid === result.instrument.tagUid) {
      return { type: 'error', errorStatus: 'duplicate', message: '測定者と同じタグです。' };
    }
    if (next.measuringInstrumentTagUid && next.measuringInstrumentTagUid !== result.instrument.tagUid) {
      return {
        type: 'error',
        errorStatus: 'error',
        message: '計測機器は既に使用前点検済みです。差し替えはできません。'
      };
    }
    next.measuringInstrumentTagUid = result.instrument.tagUid;
    next.measuringInstrumentDisplayName = instrumentLabelFromResolve(result.instrument);
  }

  return { type: 'success', draft: next };
}

type SelfInspectionNfcRegistrationState = {
  draftByEntryIndex: Record<number, SelfInspectionEntryRegistrationDraft>;
  errorStatus: SelfInspectionNfcRegistrationStatus | null;
  message: string | null;
};

type SelfInspectionNfcRegistrationAction =
  | { type: 'reset_context'; clearDrafts?: boolean }
  | {
      type: 'sync_saved';
      entryIndex: number;
      savedRegistration: SelfInspectionEntryRegistrationDraft;
      savedEntry: SavedEntryRegistrationContext;
    }
  | { type: 'resolve_start' }
  | {
      type: 'resolve_result';
      entryIndex: number;
      savedRegistration: SelfInspectionEntryRegistrationDraft;
      savedEntry: SavedEntryRegistrationContext;
      result: SelfInspectionNfcTagResolveResult;
    }
  | { type: 'resolve_failed' }
  | { type: 'clear_draft_for_entry'; entryIndex: number };

export const INITIAL_NFC_REGISTRATION_STATE: SelfInspectionNfcRegistrationState = {
  draftByEntryIndex: {},
  errorStatus: null,
  message: null
};

function registrationDraftsEqual(
  left: SelfInspectionEntryRegistrationDraft,
  right: SelfInspectionEntryRegistrationDraft
): boolean {
  return (
    left.employeeTagUid === right.employeeTagUid &&
    left.employeeDisplayName === right.employeeDisplayName &&
    left.measuringInstrumentTagUid === right.measuringInstrumentTagUid &&
    left.measuringInstrumentDisplayName === right.measuringInstrumentDisplayName
  );
}

export function reduceSelfInspectionNfcRegistrationState(
  state: SelfInspectionNfcRegistrationState,
  action: SelfInspectionNfcRegistrationAction
): SelfInspectionNfcRegistrationState {
  switch (action.type) {
    case 'reset_context':
      if (action.clearDrafts) {
        return INITIAL_NFC_REGISTRATION_STATE;
      }
      return {
        ...state,
        errorStatus: null,
        message: null
      };
    case 'sync_saved': {
      const current = state.draftByEntryIndex[action.entryIndex];
      if (current === undefined) {
        return {
          ...state,
          draftByEntryIndex: {
            ...state.draftByEntryIndex,
            [action.entryIndex]: action.savedRegistration
          }
        };
      }
      const merged = mergeSelfInspectionEntryRegistrationDraftWithSaved(
        current,
        action.savedRegistration,
        action.savedEntry
      );
      if (registrationDraftsEqual(current, merged)) {
        return state;
      }
      return {
        ...state,
        draftByEntryIndex: {
          ...state.draftByEntryIndex,
          [action.entryIndex]: merged
        }
      };
    }
    case 'resolve_start':
      return {
        ...state,
        errorStatus: 'resolving',
        message: null
      };
    case 'resolve_result': {
      const currentDraft = mergeSelfInspectionEntryRegistrationDraftWithSaved(
        state.draftByEntryIndex[action.entryIndex] ?? action.savedRegistration,
        action.savedRegistration,
        action.savedEntry
      );
      const outcome = mergeResolveResultIntoDraft(currentDraft, action.result, action.savedEntry);
      if (outcome.type === 'error') {
        return {
          ...state,
          errorStatus: outcome.errorStatus,
          message: outcome.message
        };
      }
      return {
        ...state,
        draftByEntryIndex: {
          ...state.draftByEntryIndex,
          [action.entryIndex]: outcome.draft
        },
        errorStatus: null,
        message: null
      };
    }
    case 'resolve_failed':
      return {
        ...state,
        errorStatus: 'error',
        message: 'NFCタグの解決に失敗しました。'
      };
    case 'clear_draft_for_entry': {
      if (!(action.entryIndex in state.draftByEntryIndex)) {
        return state;
      }
      const nextDraftByEntryIndex = { ...state.draftByEntryIndex };
      delete nextDraftByEntryIndex[action.entryIndex];
      return {
        ...state,
        draftByEntryIndex: nextDraftByEntryIndex
      };
    }
    default:
      return state;
  }
}

export function useSelfInspectionNfcRegistration(options: {
  session: SelfInspectionSessionDetailDto | undefined;
  selectedEntryIndex: number;
  nfcEvent: NfcEvent | null | undefined;
  enabled: boolean;
  requireMeasuringInstrumentTag: boolean;
  onInstrumentTagResolved?: (instrument: {
    id: string;
    name: string;
    managementNumber: string;
    tagUid: string;
  }) => boolean | void;
}) {
  const {
    session,
    selectedEntryIndex,
    nfcEvent,
    enabled,
    requireMeasuringInstrumentTag,
    onInstrumentTagResolved
  } = options;
  const registrationPolicy = useMemo(
    () => ({ requireMeasuringInstrumentTag }),
    [requireMeasuringInstrumentTag]
  );
  const [{ draftByEntryIndex, errorStatus, message }, dispatch] = useReducer(
    reduceSelfInspectionNfcRegistrationState,
    INITIAL_NFC_REGISTRATION_STATE
  );
  const contextGenerationRef = useRef(0);
  const lastProcessedNfcKeyRef = useRef<string | null>(null);

  const savedEntry = useMemo(
    () => session?.entries.find((entry) => entry.entryIndex === selectedEntryIndex) ?? null,
    [selectedEntryIndex, session?.entries]
  );
  const savedRegistration = useMemo(
    () => resolveSelfInspectionEntryRegistrationFromSaved(savedEntry),
    [savedEntry]
  );
  const isLocked = false;

  const draft = useMemo(
    () =>
      resolveSelfInspectionEntryRegistrationForDisplay(
        draftByEntryIndex[selectedEntryIndex],
        savedEntry
      ),
    [draftByEntryIndex, savedEntry, selectedEntryIndex]
  );

  useEffect(() => {
    contextGenerationRef.current += 1;
    dispatch({ type: 'reset_context', clearDrafts: true });
    lastProcessedNfcKeyRef.current = null;
  }, [session?.id]);

  useEffect(() => {
    contextGenerationRef.current += 1;
    dispatch({ type: 'reset_context' });
    lastProcessedNfcKeyRef.current = null;
  }, [selectedEntryIndex]);

  useEffect(() => {
    if (!session || isLocked) return;
    dispatch({
      type: 'sync_saved',
      entryIndex: selectedEntryIndex,
      savedRegistration,
      savedEntry
    });
  }, [isLocked, savedEntry, savedRegistration, selectedEntryIndex, session]);

  useEffect(() => {
    if (!isLocked) return;
    dispatch({ type: 'clear_draft_for_entry', entryIndex: selectedEntryIndex });
  }, [isLocked, selectedEntryIndex]);

  const applyResolvedUid = useCallback(
    async (uid: string) => {
      if (!enabled || isLocked) return;
      const contextGeneration = contextGenerationRef.current;
      const entryIndex = selectedEntryIndex;
      dispatch({ type: 'resolve_start' });
      try {
        const result = await resolveSelfInspectionNfcTagUid(uid);
        if (contextGeneration !== contextGenerationRef.current) {
          return;
        }
        if (result.kind === 'instrument' && onInstrumentTagResolved?.(result.instrument) === true) {
          return;
        }
        dispatch({
          type: 'resolve_result',
          entryIndex,
          savedRegistration,
          savedEntry,
          result
        });
      } catch {
        if (contextGeneration !== contextGenerationRef.current) {
          return;
        }
        dispatch({ type: 'resolve_failed' });
      }
    },
    [enabled, isLocked, onInstrumentTagResolved, savedEntry, savedRegistration, selectedEntryIndex]
  );

  useEffect(() => {
    if (!enabled || !nfcEvent?.uid || isLocked) return;
    const eventKey = `${nfcEvent.uid}:${nfcEvent.timestamp ?? ''}:${selectedEntryIndex}`;
    if (lastProcessedNfcKeyRef.current === eventKey) return;
    lastProcessedNfcKeyRef.current = eventKey;
    void applyResolvedUid(nfcEvent.uid);
  }, [applyResolvedUid, enabled, isLocked, nfcEvent, selectedEntryIndex]);

  const status = deriveStatus(draft, errorStatus, registrationPolicy);

  const registrationPayload = useMemo(() => {
    if (!isSelfInspectionEntryRegistrationReadyForSave(draft, savedEntry, registrationPolicy)) {
      return null;
    }
    return buildSelfInspectionEntryRegistrationPayload(draft, savedEntry);
  }, [draft, registrationPolicy, savedEntry]);

  const registrationDirty = useMemo(
    () => isSelfInspectionEntryRegistrationDirtyForSave(draft, savedEntry, registrationPolicy),
    [draft, registrationPolicy, savedEntry]
  );

  const hasUnsavedRegistrationDrafts = useMemo(() => {
    if (!session) return false;
    return hasUnsavedSelfInspectionRegistrationDrafts(session, draftByEntryIndex, registrationPolicy);
  }, [draftByEntryIndex, registrationPolicy, session]);

  const view: SelfInspectionNfcRegistrationView = {
    ...draft,
    status: status === 'resolving' ? 'resolving' : status,
    message,
    isReady: isSelfInspectionEntryRegistrationReadyForSave(draft, savedEntry, registrationPolicy),
    isLocked,
    nextActionLabel: isLocked ? null : nextActionLabelForDraft(draft, savedEntry, registrationPolicy)
  };

  return {
    registration: view,
    registrationPayload,
    registrationDirty,
    hasUnsavedRegistrationDrafts,
    clearDraftForEntry: (entryIndex: number) => {
      dispatch({ type: 'clear_draft_for_entry', entryIndex });
    }
  };
}

export function emptySelfInspectionEntryRegistrationDraft(): SelfInspectionEntryRegistrationDraft {
  return { ...EMPTY_DRAFT };
}
